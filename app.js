const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
require('dotenv').config();
const app = express();
const db = require('./db');

const userController = require('./controllers/UserController');
const cartController = require('./controllers/CartController');
const productController = require('./controllers/ProductController');
const orderController = require('./controllers/OrderController');
const reviewController = require('./controllers/ReviewController');
const Order = require('./models/order');
const refundController = require('./controllers/RefundController');
const paypal = require('./services/paypal');
const {
    checkAuthenticated,
    checkAdmin,
    checkRoles
} = require('./middleware');

const ensureRefundRequestsTable = () => {
    const createSql = `
        CREATE TABLE IF NOT EXISTS refund_requests (
            id INT NOT NULL AUTO_INCREMENT,
            order_id INT NOT NULL,
            user_id INT NOT NULL,
            requested_amount DECIMAL(10,2) DEFAULT NULL,
            refunded_amount DECIMAL(10,2) DEFAULT NULL,
            reason VARCHAR(255) NOT NULL,
            admin_note VARCHAR(255) DEFAULT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'requested',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY refund_requests_order_id_idx (order_id),
            KEY refund_requests_user_id_idx (user_id),
            CONSTRAINT refund_requests_order_id_fk FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
            CONSTRAINT refund_requests_user_id_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `;

    db.query(createSql, (createErr) => {
        if (createErr) {
            console.error('Error ensuring refund_requests table:', createErr);
            return;
        }
        const alterSql = `
            ALTER TABLE refund_requests
            MODIFY reason VARCHAR(255) NOT NULL
        `;
        db.query(alterSql, (alterErr) => {
            if (alterErr) {
                console.error('Error updating refund_requests schema:', alterErr);
            }
        });
    });
};

ensureRefundRequestsTable();

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images');
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

// Set up view engine
app.set('view engine', 'ejs');
// Enable static files
app.use(express.static('public'));
// Enable form processing
app.use(express.urlencoded({
    extended: false
}));
app.use(express.json());

// Session Middleware
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } 
}));

app.use(flash());

// Routes
app.get('/', (req, res) => {
    res.render('index', {user: req.session.user});
});

app.get('/inventory', checkAuthenticated, checkAdmin, productController.showInventory);

app.get('/register', userController.showRegister);
app.post('/register', userController.register);

app.get('/login', userController.showLogin);
app.post('/login', userController.login);

app.get('/admin/users', checkAuthenticated, checkAdmin, userController.listUsers);
app.get('/admin/users/:id/edit', checkAuthenticated, checkAdmin, userController.editUserForm);
app.post('/admin/users/:id', checkAuthenticated, checkAdmin, userController.updateUserRole);
app.post('/admin/users/:id/delete', checkAuthenticated, checkAdmin, userController.deleteUser);
app.get('/admin/refunds', checkAuthenticated, checkAdmin, refundController.listRefunds);
app.post('/admin/refunds/:id/approve', checkAuthenticated, checkAdmin, refundController.approveRefund);
app.post('/admin/refunds/:id/deny', checkAuthenticated, checkAdmin, refundController.denyRefund);

app.get('/shopping', checkAuthenticated, checkRoles('user'), productController.showShopping);

app.post('/add-to-cart/:id', checkAuthenticated, checkRoles('user'), cartController.addToCart);
app.get('/cart', checkAuthenticated, checkRoles('user'), cartController.viewCart);
app.post('/cart/update/:id', checkAuthenticated, checkRoles('user'), cartController.updateCartItem);
app.post('/cart/remove/:id', checkAuthenticated, checkRoles('user'), cartController.removeCartItem);
app.post('/checkout', checkAuthenticated, checkRoles('user'), orderController.checkout);
app.get('/orders/history', checkAuthenticated, checkRoles('user', 'admin'), orderController.history);
app.post('/orders/:id/delivery', checkAuthenticated, orderController.updateDeliveryDetails);
app.get('/orders/:id/invoice', checkAuthenticated, orderController.invoice);
app.post('/orders/:id/refund-request', checkAuthenticated, checkRoles('user'), refundController.requestRefund);

// PayPal: Create Order
app.post('/api/paypal/create-order', checkAuthenticated, checkRoles('user'), async (req, res) => {
    try {
        const deliveryMethod = req.body.deliveryMethod;
        const deliveryAddress = req.body.deliveryAddress;
        const checkout = await orderController.getCheckoutContext(req, { deliveryMethod, deliveryAddress });
        req.session.pendingCheckout = {
            deliveryMethod: checkout.deliveryMethod,
            deliveryAddress: checkout.deliveryAddress
        };
        const order = await paypal.createOrder(checkout.total.toFixed(2));
        if (order && order.id) {
            res.json({ id: order.id, total: checkout.total });
        } else {
            res.status(500).json({ error: 'Failed to create PayPal order', details: order });
        }
    } catch (err) {
        res.status(400).json({ error: 'Failed to create PayPal order', message: err.message });
    }
});

// PayPal: Capture Order
app.post('/api/paypal/capture-order', checkAuthenticated, checkRoles('user'), async (req, res) => {
    try {
        const { orderID } = req.body;
        if (!orderID) {
            return res.status(400).json({ error: 'Missing PayPal order ID.' });
        }
        const capture = await paypal.captureOrder(orderID);
        console.log('PayPal captureOrder response:', capture);

        const captureDetails = capture?.purchase_units?.[0]?.payments?.captures?.[0];
        const captureId = captureDetails?.id;

        if (capture.status === 'COMPLETED' && captureId) {
            const pending = req.session.pendingCheckout || {};
            const checkout = await orderController.getCheckoutContext(req, pending);
            const orderResult = await orderController.createOrderFromContext(req, checkout);
            await new Promise((resolve, reject) => {
                Order.updatePayment(orderResult.orderId, {
                    method: 'paypal',
                    status: 'paid',
                    reference: captureId
                }, (err) => {
                    if (err) {
                        return reject(err);
                    }
                    return resolve();
                });
            });
            req.session.pendingCheckout = null;
            req.flash('success', `Thanks for your purchase! ${checkout.deliveryMethod === 'delivery' ? 'We will deliver your order shortly.' : 'Pickup details will be shared soon.'}`);
            res.json({ success: true, orderId: orderResult.orderId, redirect: '/orders/history' });
        } else {
            res.status(400).json({ error: 'Payment not completed', details: capture });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to capture PayPal order', message: err.message });
    }
});

// PayPal: Refund (full or partial) - admin only
app.post('/api/paypal/refund', checkAuthenticated, checkAdmin, async (req, res) => {
    try {
        const orderId = parseInt(req.body.orderId, 10);
        if (!Number.isFinite(orderId)) {
            return res.status(400).json({ error: 'Invalid order ID.' });
        }

        const amountRaw = req.body.amount;
        const refundAmount = amountRaw !== undefined && amountRaw !== null && String(amountRaw).trim() !== ''
            ? Number.parseFloat(amountRaw)
            : null;

        if (refundAmount !== null && (!Number.isFinite(refundAmount) || refundAmount <= 0)) {
            return res.status(400).json({ error: 'Invalid refund amount.' });
        }

        const orderRows = await new Promise((resolve, reject) => {
            Order.findById(orderId, (err, rows) => {
                if (err) return reject(err);
                return resolve(rows);
            });
        });

        if (!orderRows || !orderRows.length) {
            return res.status(404).json({ error: 'Order not found.' });
        }

        const order = orderRows[0];
        if (order.payment_method !== 'paypal' || !order.payment_reference) {
            return res.status(400).json({ error: 'Order is not a PayPal payment or missing capture reference.' });
        }

        const orderTotal = Number.parseFloat(order.total);
        if (refundAmount !== null && refundAmount > orderTotal) {
            return res.status(400).json({ error: 'Refund amount exceeds order total.' });
        }

        const refundResponse = await paypal.refundCapture(
            order.payment_reference,
            refundAmount !== null ? refundAmount.toFixed(2) : null
        );

        if (refundResponse && (refundResponse.status === 'COMPLETED' || refundResponse.status === 'PENDING')) {
            const status = refundAmount !== null && refundAmount < orderTotal
                ? 'partially_refunded'
                : 'refunded';
            await new Promise((resolve, reject) => {
                Order.updatePayment(orderId, {
                    method: 'paypal',
                    status,
                    reference: order.payment_reference
                }, (err) => {
                    if (err) return reject(err);
                    return resolve();
                });
            });
            const Payment = require('./models/payment');
            const RefundRequest = require('./models/refundRequest');
            const refundedValue = refundResponse.amount && refundResponse.amount.value
                ? Number.parseFloat(refundResponse.amount.value)
                : (refundAmount !== null ? refundAmount : orderTotal);
            await new Promise((resolve, reject) => {
                Payment.createRefund(
                    orderId,
                    'paypal',
                    status,
                    refundedValue,
                    refundResponse.id,
                    JSON.stringify(refundResponse),
                    (err) => {
                        if (err) return reject(err);
                        return resolve();
                    }
                );
            });
            const refundRequestId = Number.parseInt(req.body.refundRequestId, 10);
            if (Number.isFinite(refundRequestId)) {
                await new Promise((resolve, reject) => {
                    RefundRequest.updateStatus(
                        refundRequestId,
                        status,
                        req.body.adminNote || null,
                        refundedValue,
                        (err) => {
                            if (err) return reject(err);
                            return resolve();
                        }
                    );
                });
            }
            return res.json({ success: true, refund: refundResponse });
        }

        console.error('PayPal refund failed:', refundResponse);
        const errorMessage = refundResponse && (refundResponse.message || refundResponse.name)
            ? `${refundResponse.name || 'PayPalError'}: ${refundResponse.message || 'Refund failed'}`
            : 'Refund failed';
        return res.status(400).json({
            error: errorMessage,
            debugId: refundResponse && refundResponse.debug_id ? refundResponse.debug_id : null,
            details: refundResponse
        });
    } catch (err) {
        console.error('Refund exception:', err);
        return res.status(500).json({ error: 'Refund failed', message: err.message });
    }
});

// PayPal: Manually link/update a capture ID to an order (admin only)
app.post('/api/paypal/link-capture', checkAuthenticated, checkAdmin, async (req, res) => {
    try {
        const orderId = parseInt(req.body.orderId, 10);
        const captureId = (req.body.captureId || '').trim();
        if (!Number.isFinite(orderId)) {
            return res.status(400).json({ error: 'Invalid order ID.' });
        }
        if (!captureId) {
            return res.status(400).json({ error: 'Capture ID is required.' });
        }

        const orderRows = await new Promise((resolve, reject) => {
            Order.findById(orderId, (err, rows) => {
                if (err) return reject(err);
                return resolve(rows);
            });
        });

        if (!orderRows || !orderRows.length) {
            return res.status(404).json({ error: 'Order not found.' });
        }

        const nextStatus = orderRows[0].payment_status && orderRows[0].payment_status !== 'unpaid'
            ? orderRows[0].payment_status
            : 'paid';

        await new Promise((resolve, reject) => {
            Order.updatePayment(orderId, {
                method: 'paypal',
                status: nextStatus,
                reference: captureId
            }, (err) => {
                if (err) return reject(err);
                return resolve();
            });
        });

        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to link capture ID', message: err.message });
    }
});

app.get('/logout', userController.logout);

app.get('/product/:id', checkAuthenticated, productController.showProductDetails);
app.post('/product/:id/reviews', checkAuthenticated, checkRoles('user'), reviewController.upsert);
app.post('/product/:id/reviews/:reviewId/delete', checkAuthenticated, checkRoles('user'), reviewController.remove);

app.get('/addProduct', checkAuthenticated, checkAdmin, productController.showAddProductForm);
app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), productController.addProduct);

app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, productController.showUpdateProductForm);
app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), productController.updateProduct);

app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, productController.deleteProduct);
app.get('/admin/deliveries', checkAuthenticated, checkAdmin, orderController.listAllDeliveries);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
