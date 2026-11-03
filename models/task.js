// Load required packages
var mongoose = require('mongoose');

// Define our task schema
var TaskSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, default: '' },
    deadline: { type: Date, required: true },
    completed: { type: Boolean, default: false },
    // _id string of the assigned user, "" when unassigned
    assignedUser: { type: String, default: '' },
    // name of the assigned user, "unassigned" when unassigned
    assignedUserName: { type: String, default: 'unassigned' }
}, {
    // dateCreated is set by the server on create and never changes afterwards
    timestamps: { createdAt: 'dateCreated', updatedAt: false },
    versionKey: false
});

// Export the Mongoose model
module.exports = mongoose.model('Task', TaskSchema);
