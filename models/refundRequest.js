const connection = require('../db');

const createRequest = (orderId, userId, amount, reason, callback) => {
    const sql = `
        INSERT INTO refund_requests (order_id, user_id, requested_amount, reason, status)
        VALUES (?, ?, ?, ?, 'requested')
    `;
    const safeAmount = Number.isFinite(amount) ? Number(amount.toFixed(2)) : null;
    connection.query(sql, [orderId, userId, safeAmount, reason], callback);
};

const findByOrderIds = (orderIds, callback) => {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return callback(null, []);
    }
    const sql = `
        SELECT *
        FROM refund_requests
        WHERE order_id IN (?)
        ORDER BY created_at DESC, id DESC
    `;
    connection.query(sql, [orderIds], callback);
};

const findAll = (callback) => {
    const sql = `
        SELECT
            rr.*,
            o.total AS order_total,
            o.payment_method,
            o.payment_status,
            o.payment_reference AS capture_reference,
            u.username,
            u.email
        FROM refund_requests rr
        JOIN orders o ON o.id = rr.order_id
        JOIN users u ON u.id = rr.user_id
        ORDER BY rr.created_at DESC, rr.id DESC
    `;
    connection.query(sql, callback);
};

const updateStatus = (refundRequestId, status, adminNote, refundedAmount, callback) => {
    const sql = `
        UPDATE refund_requests
        SET status = ?, admin_note = ?, refunded_amount = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `;
    const safeAmount = Number.isFinite(refundedAmount) ? Number(refundedAmount.toFixed(2)) : null;
    connection.query(sql, [status, adminNote || null, safeAmount, refundRequestId], callback);
};

module.exports = {
    createRequest,
    findByOrderIds,
    findAll,
    updateStatus
};
