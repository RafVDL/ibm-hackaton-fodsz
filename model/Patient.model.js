const mongoose = require('mongoose');
const Click = require('./Click.model.js');

module.exports = mongoose.model('Patient', {
    patient_id: String,
    illness: String,
    clicks: [{ type: mongoose.Schema.Types.ObjectId,  ref: 'Click' }],
    score: [{
        category: String,
        score: Number
    }]
});