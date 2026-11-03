var express = require('express');
var User = require('../models/user');
var Task = require('../models/task');
var h = require('./helpers');

var HttpError = h.HttpError;
var router = express.Router();

function parseDeadline(value) {
    if (!h.given(value) || value === '') throw new HttpError(400, 'Deadline is required');
    var date;
    if (typeof value === 'number') {
        date = new Date(value);
    } else if (typeof value === 'string') {
        // Accept a millisecond timestamp sent as text (e.g. from a form) or a date string.
        date = /^\s*-?\d+(\.\d+)?\s*$/.test(value) ? new Date(Number(value)) : new Date(value);
    } else {
        throw new HttpError(400, 'Deadline must be a date');
    }
    if (isNaN(date.getTime())) throw new HttpError(400, 'Deadline is not a valid date');
    return date;
}

function parseCompleted(value) {
    if (!h.given(value)) return false;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new HttpError(400, 'Completed must be true or false');
}

// Check the body of POST / PUT. Throws 400 for bad fields.
function parseTaskBody(body) {
    var fields = {
        name: h.requireString(body, 'name', 'Name'),
        description: h.optionalString(body, 'description', 'Description', ''),
        deadline: parseDeadline(body.deadline),
        completed: parseCompleted(body.completed),
        assignedUser: h.optionalString(body, 'assignedUser', 'assignedUser', '').trim()
    };
    var userName = h.optionalString(body, 'assignedUserName', 'assignedUserName', undefined);

    if (fields.assignedUser === '') {
        if (userName !== undefined && userName !== '' && userName !== 'unassigned') {
            throw new HttpError(400, 'assignedUserName is set but assignedUser is empty');
        }
        fields.assignedUserName = 'unassigned';
    } else if (!h.isObjectId(fields.assignedUser)) {
        throw new HttpError(400, 'assignedUser is not a valid user id');
    } else {
        fields.assignedUser = fields.assignedUser.toLowerCase();
    }
    return { fields: fields, requestedUserName: userName };
}

// The assigned user must exist (404) and match assignedUserName (400).
async function checkTaskRefs(parsed) {
    var fields = parsed.fields;
    if (fields.assignedUser === '') return;

    var user = await User.findById(fields.assignedUser).select('name');
    if (!user) throw new HttpError(404, 'Assigned user does not exist');

    var requested = parsed.requestedUserName;
    if (requested !== undefined && requested !== '' && requested !== user.name) {
        throw new HttpError(400, 'assignedUserName does not match the assigned user');
    }
    fields.assignedUserName = user.name; // fill in when omitted
}

// Make users' pendingTasks match the (already saved) task.
async function syncUsersToTask(task) {
    var taskId = String(task._id);
    var assigned = task.assignedUser;

    // Remove the task from every user other than its current assignee.
    var others = { pendingTasks: taskId };
    if (assigned) others._id = { $ne: assigned };
    await User.updateMany(others, { $pull: { pendingTasks: taskId } });

    if (!assigned) return;
    if (task.completed) {
        await User.updateOne({ _id: assigned }, { $pull: { pendingTasks: taskId } });
    } else {
        await User.updateOne({ _id: assigned }, { $addToSet: { pendingTasks: taskId } });
    }
}

router.get('/', h.handle(async function (req, res) {
    var data = await h.listDocuments(Task, req.query, 100);
    h.send(res, 200, 'OK', data);
}));

router.post('/', h.handle(async function (req, res) {
    var parsed = parseTaskBody(req.body || {});
    await checkTaskRefs(parsed);

    var task = await new Task(parsed.fields).save();
    await syncUsersToTask(task);
    h.send(res, 201, 'Task created', task);
}));

router.get('/:id', h.handle(async function (req, res) {
    var task = await h.getOne(Task, req.params.id, req.query, 'Task');
    h.send(res, 200, 'OK', task);
}));

router.put('/:id', h.handle(async function (req, res) {
    var id = req.params.id;
    var task = h.isObjectId(id) ? await Task.findById(id) : null;
    if (!task) throw new HttpError(404, 'Task not found');

    var parsed = parseTaskBody(req.body || {});
    await checkTaskRefs(parsed);

    task.set(parsed.fields);
    await task.save();
    await syncUsersToTask(task);
    h.send(res, 200, 'Task updated', task);
}));

router.delete('/:id', h.handle(async function (req, res) {
    var id = req.params.id;
    var task = h.isObjectId(id) ? await Task.findByIdAndDelete(id) : null;
    if (!task) throw new HttpError(404, 'Task not found');

    var taskId = String(task._id);
    await User.updateMany({ pendingTasks: taskId }, { $pull: { pendingTasks: taskId } });
    h.send(res, 200, 'Task deleted', task);
}));

module.exports = router;
