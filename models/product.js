const connection = require('../db');

// Product model
const Product = {
    getAll: (callback) => {
        const sql = 'SELECT * FROM products';
        connection.query(sql, callback);
    },

    getByCategory: (category, callback) => {
        const sql = 'SELECT * FROM products WHERE category = ?';
        connection.query(sql, [category], callback);
    },

    getCategories: (callback) => {
        const sql = 'SELECT DISTINCT category FROM products ORDER BY category ASC';
        connection.query(sql, callback);
    },

    getById: (productId, callback) => {
        const sql = 'SELECT * FROM products WHERE id = ?';
        connection.query(sql, [productId], callback);
    },

    create: (productData, callback) => {
        const {
            name,
            quantity,
            price,
            image,
            discountPercentage = 0,
            offerMessage = null,
            category = 'General'
        } = productData;
        const sql = `
            INSERT INTO products
                (productName, quantity, price, discountPercentage, offerMessage, image, category)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        connection.query(sql, [name, quantity, price, discountPercentage, offerMessage, image, category], callback);
    },

    update: (productId, productData, callback) => {
        const {
            name,
            quantity,
            price,
            image,
            discountPercentage = 0,
            offerMessage = null,
            category = 'General'
        } = productData;
        const sql = `
            UPDATE products
            SET productName = ?, quantity = ?, price = ?, discountPercentage = ?, offerMessage = ?, image = ?, category = ?
            WHERE id = ?
        `;
        connection.query(sql, [name, quantity, price, discountPercentage, offerMessage, image, category, productId], callback);
    },

    delete: (productId, callback) => {
        const sql = 'DELETE FROM products WHERE id = ?';
        connection.query(sql, [productId], callback);
    }
};

module.exports = Product;
