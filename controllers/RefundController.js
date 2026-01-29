const Payment = require('../models/payment');
const RefundRequest = require('../models/refundRequest');
const Order = require('../models/order');

const listRefunds = (req, res) => {
    RefundRequest.findAll((reqErr, refundRequests) => {
        if (reqErr) {
            console.error('Error fetching refund requests:', reqErr);
            req.flash('error', 'Unable to load refund requests.');
            return res.redirect('/admin/deliveries');
        }

        Payment.findRefunds((err, refunds) => {
            if (err) {
                console.error('Error fetching refunds:', err);
                req.flash('error', 'Unable to load refunds.');
                return res.redirect('/admin/deliveries');
            }

            return res.render('adminRefunds', {
                user: req.session.user,
                refundRequests: refundRequests || [],
                refunds: refunds || [],
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    });
};

const requestRefund = (req, res) => {
    const orderId = parseInt(req.params.id, 10);
    const amountRaw = req.body.amount;
    const reason = (req.body.reason || '').trim();

    if (!Number.isFinite(orderId)) {
        req.flash('error', 'Invalid order selected.');
        return res.redirect('/orders/history');
    }

    if (!reason) {
        req.flash('error', 'Refund reason is required.');
        return res.redirect('/orders/history');
    }

    const amount = amountRaw && String(amountRaw).trim() !== ''
        ? Number.parseFloat(amountRaw)
        : null;
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
        req.flash('error', 'Invalid refund amount.');
        return res.redirect('/orders/history');
    }

    Order.findById(orderId, (orderErr, orderRows) => {
        if (orderErr || !orderRows || !orderRows.length) {
            req.flash('error', 'Order not found.');
            return res.redirect('/orders/history');
        }

        const order = orderRows[0];
        if (order.user_id !== req.session.user.id) {
            req.flash('error', 'You are not authorised to request a refund for this order.');
            return res.redirect('/orders/history');
        }

        RefundRequest.createRequest(orderId, req.session.user.id, amount, reason, (createErr) => {
            if (createErr) {
                console.error('Error creating refund request:', createErr);
                req.flash('error', 'Unable to submit refund request.');
                return res.redirect('/orders/history');
            }
            req.flash('success', 'Refund request submitted.');
            return res.redirect('/orders/history');
        });
    });
};

const approveRefund = (req, res) => {
    const refundRequestId = parseInt(req.params.id, 10);
    if (!Number.isFinite(refundRequestId)) {
        return res.status(400).json({ error: 'Invalid refund request ID.' });
    }

    RefundRequest.updateStatus(refundRequestId, 'approved', req.body.adminNote || null, null, (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to approve refund request.' });
        }
        return res.json({ success: true });
    });
};

const denyRefund = (req, res) => {
    const refundRequestId = parseInt(req.params.id, 10);
    if (!Number.isFinite(refundRequestId)) {
        return res.status(400).json({ error: 'Invalid refund request ID.' });
    }

    RefundRequest.updateStatus(refundRequestId, 'denied', req.body.adminNote || null, null, (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to deny refund request.' });
        }
        return res.json({ success: true });
    });
};

module.exports = {
    listRefunds,
    requestRefund,
    approveRefund,
    denyRefund
};
