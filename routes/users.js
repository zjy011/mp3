var express = require('express');
var User = require('../models/user');
var Task = require('../models/task');
var h = require('./helpers');

var HttpError = h.HttpError;
var router = express.Router();

// Check the body of POST / PUT. Throws 400 for bad fields.
function parseUserBody(body) {
    var name = h.requireString(body, 'name', 'Name');
    var email = h.requireString(body, 'email', 'Email');
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
        throw new HttpError(400, 'Email is not a valid email address');
    }

    var pending = body.pendingTasks;
    if (!h.given(pending)) pending = [];
    if (typeof pending === 'string') pending = [pending]; // a single id from a form
    if (!Array.isArray(pending)) {
        throw new HttpError(400, 'pendingTasks must be a list of task ids');
    }
    pending.forEach(function (id) {
        if (!h.isObjectId(id)) {
            throw new HttpError(400, 'pendingTasks contains an invalid task id');
        }
    });
    pending = Array.from(new Set(pending.map(function (id) { return id.toLowerCase(); })));

    return { name: name, email: email, pendingTasks: pending };
}

// Checks that need the database, in the required order:
// duplicate email (400), unknown task (404), completed task (400).
async function checkUserRefs(fields, userId) {
    var emailFilter = { email: fields.email };
    if (userId) emailFilter._id = { $ne: userId };
    if (await User.exists(emailFilter)) {
        throw new HttpError(400, 'A user with that email already exists');
    }

    if (fields.pendingTasks.length === 0) return;
    var tasks = await Task.find({ _id: { $in: fields.pendingTasks } }).select('completed');
    if (tasks.length !== fields.pendingTasks.length) {
        throw new HttpError(404, 'One or more tasks in pendingTasks do not exist');
    }
    if (tasks.some(function (t) { return t.completed === true; })) {
        throw new HttpError(400, 'Completed tasks cannot be in pendingTasks');
    }
}

// Make the tasks match the user's (already saved) pendingTasks list.
async function syncTasksToUser(user) {
    var userId = String(user._id);
    var pending = user.pendingTasks;

    // Tasks moving here from another user leave that user's pendingTasks.
    if (pending.length > 0) {
        await User.updateMany(
            { _id: { $ne: user._id }, pendingTasks: { $in: pending } },
            { $pull: { pendingTasks: { $in: pending } } }
        );
    }

    // Pending tasks of this user that are no longer in the list get unassigned.
    await Task.updateMany(
        { assignedUser: userId, completed: { $ne: true }, _id: { $nin: pending } },
        { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
    );

    // Tasks in the list are assigned to this user.
    if (pending.length > 0) {
        await Task.updateMany(
            { _id: { $in: pending } },
            { $set: { assignedUser: userId, assignedUserName: user.name } }
        );
    }

    // Keep assignedUserName current on all of this user's tasks (completed too).
    await Task.updateMany(
        { assignedUser: userId, assignedUserName: { $ne: user.name } },
        { $set: { assignedUserName: user.name } }
    );
}

router.get('/', h.handle(async function (req, res) {
    var data = await h.listDocuments(User, req.query, 0);
    h.send(res, 200, 'OK', data);
}));

router.post('/', h.handle(async function (req, res) {
    var fields = parseUserBody(req.body || {});
    await checkUserRefs(fields, null);

    var user = await new User(fields).save();
    await syncTasksToUser(user);
    h.send(res, 201, 'User created', user);
}));

router.get('/:id', h.handle(async function (req, res) {
    var user = await h.getOne(User, req.params.id, req.query, 'User');
    h.send(res, 200, 'OK', user);
}));

router.put('/:id', h.handle(async function (req, res) {
    var id = req.params.id;
    var user = h.isObjectId(id) ? await User.findById(id) : null;
    if (!user) throw new HttpError(404, 'User not found');

    var fields = parseUserBody(req.body || {});
    await checkUserRefs(fields, user._id);

    user.name = fields.name;
    user.email = fields.email;
    user.pendingTasks = fields.pendingTasks;
    await user.save();
    await syncTasksToUser(user);
    h.send(res, 200, 'User updated', user);
}));

router.delete('/:id', h.handle(async function (req, res) {
    var id = req.params.id;
    var user = h.isObjectId(id) ? await User.findByIdAndDelete(id) : null;
    if (!user) throw new HttpError(404, 'User not found');

    // All of the user's tasks, completed ones included, become unassigned.
    await Task.updateMany(
        { assignedUser: String(user._id) },
        { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
    );
    res.status(204).end();
}));

module.exports = router;
