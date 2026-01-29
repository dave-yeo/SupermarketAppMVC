const connection = require('../db');

const createRefund = (orderId, method, status, amount, providerReference, payload, callback) => {
    const sql = `
        INSERT INTO payments (order_id, method, status, amount, provider_reference, payload)
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    const safeAmount = Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0;
    connection.query(
        sql,
        [orderId, method, status, safeAmount, providerReference || null, payload || null],
        callback
    );
};

const findRefunds = (callback) => {
    const sql = `
        SELECT
            p.id,
            p.order_id,
            p.method,
            p.status,
            p.amount,
            p.provider_reference,
            p.created_at,
            o.total AS order_total,
            o.payment_reference AS capture_reference,
            u.username,
            u.email
        FROM payments p
        JOIN orders o ON o.id = p.order_id
        JOIN users u ON u.id = o.user_id
        WHERE p.status IN ('refunded', 'partially_refunded')
        ORDER BY p.created_at DESC, p.id DESC
    `;
    connection.query(sql, callback);
};

const getRefundTotals = (orderIds, callback) => {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return callback(null, []);
    }

    const sql = `
        SELECT order_id, SUM(amount) AS refunded_total
        FROM payments
        WHERE order_id IN (?)
          AND status IN ('refunded', 'partially_refunded')
        GROUP BY order_id
    `;
    connection.query(sql, [orderIds], callback);
};

module.exports = {
    createRefund,
    findRefunds,
    getRefundTotals
};
