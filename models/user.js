// Load required packages
var mongoose = require('mongoose');

// Define our user schema
var UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    // _id strings of this user's pending (not completed) tasks
    pendingTasks: { type: [String], default: [] }
}, {
    // dateCreated is set by the server on create and never changes afterwards
    timestamps: { createdAt: 'dateCreated', updatedAt: false },
    versionKey: false
});

// Export the Mongoose model
module.exports = mongoose.model('User', UserSchema);
