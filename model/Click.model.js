const mongoose = require('mongoose');

ClickSchema = new mongoose.Schema({
    keyword: String
}, { timestamps: true });

module.exports = mongoose.model('Click', ClickSchema);