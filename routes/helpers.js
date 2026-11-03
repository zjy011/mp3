/*
 * Shared helpers for the users and tasks routes.
 */

// An error with an HTTP status and a client-safe message.
class HttpError extends Error {
    constructor(status, message, data) {
        super(message);
        this.status = status;
        this.data = data === undefined ? null : data;
    }
}

function send(res, status, message, data) {
    res.status(status).json({ message: message, data: data === undefined ? null : data });
}

// Wrap an async handler so every failure becomes a {message, data} response.
// Raw Mongoose/MongoDB errors are never sent to the client.
function handle(fn) {
    return async function (req, res) {
        try {
            await fn(req, res);
        } catch (err) {
            if (err instanceof HttpError) {
                return send(res, err.status, err.message, err.data);
            }
            if (err && err.code === 11000) {
                return send(res, 400, 'A user with that email already exists', null);
            }
            if (err && (err.name === 'CastError' || err.name === 'ValidationError' ||
                        err.name === 'StrictModeError')) {
                return send(res, 400, 'The request contains invalid values', null);
            }
            console.error(err);
            send(res, 500, 'Something went wrong on the server. Please try again later.', null);
        }
    };
}

// A MongoDB ObjectId in its 24 hex character string form.
function isObjectId(value) {
    return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonParam(query, name) {
    var raw = query[name];
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string') {
        throw new HttpError(400, 'Query parameter "' + name + '" must be given once, as JSON');
    }
    var value;
    try {
        value = JSON.parse(raw);
    } catch (e) {
        throw new HttpError(400, 'Query parameter "' + name + '" is not valid JSON');
    }
    if (!isPlainObject(value)) {
        throw new HttpError(400, 'Query parameter "' + name + '" must be a JSON object');
    }
    return value;
}

function parseIntParam(query, name) {
    var raw = query[name];
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || !/^\s*\d+\s*$/.test(raw)) {
        throw new HttpError(400, 'Query parameter "' + name + '" must be a non-negative integer');
    }
    return parseInt(raw, 10);
}

// "select" (also accepted under the old name "filter").
function parseSelect(query) {
    var select = parseJsonParam(query, 'select');
    if (select === undefined) select = parseJsonParam(query, 'filter');
    return select;
}

function parseListQuery(query) {
    var count = query.count;
    if (count !== undefined && count !== 'true' && count !== 'false') {
        throw new HttpError(400, 'Query parameter "count" must be true or false');
    }
    return {
        where: parseJsonParam(query, 'where') || {},
        sort: parseJsonParam(query, 'sort'),
        select: parseSelect(query),
        skip: parseIntParam(query, 'skip'),
        limit: parseIntParam(query, 'limit'),
        count: count === 'true'
    };
}

// GET on a collection: where, sort, select, skip, limit, count, all done by Mongoose.
async function listDocuments(Model, query, defaultLimit) {
    var q = parseListQuery(query);

    if (q.count) {
        var countQuery = Model.countDocuments(q.where);
        if (q.skip !== undefined) countQuery.skip(q.skip);
        if (q.limit !== undefined && q.limit > 0) countQuery.limit(q.limit);
        return countQuery.exec();
    }

    var find = Model.find(q.where);
    if (q.sort) find.sort(q.sort);
    if (q.select) find.select(q.select);
    if (q.skip !== undefined) find.skip(q.skip);
    var limit = q.limit !== undefined ? q.limit : defaultLimit;
    if (limit) find.limit(limit);
    return find.exec();
}

// GET on one document: only "select" applies. Unknown or malformed id -> 404.
async function getOne(Model, id, query, label) {
    if (!isObjectId(id)) throw new HttpError(404, label + ' not found');
    var select = parseSelect(query);
    var find = Model.findById(id);
    if (select) find.select(select);
    var doc = await find.exec();
    if (!doc) throw new HttpError(404, label + ' not found');
    return doc;
}

// Treat null / undefined as "not given".
function given(value) {
    return value !== undefined && value !== null;
}

function requireString(body, field, label) {
    var value = body[field];
    if (!given(value) || (typeof value === 'string' && value.trim() === '')) {
        throw new HttpError(400, label + ' is required');
    }
    if (typeof value !== 'string') {
        throw new HttpError(400, label + ' must be a string');
    }
    return value.trim();
}

function optionalString(body, field, label, fallback) {
    var value = body[field];
    if (!given(value)) return fallback;
    if (typeof value !== 'string') {
        throw new HttpError(400, label + ' must be a string');
    }
    return value;
}

module.exports = {
    HttpError: HttpError,
    send: send,
    handle: handle,
    isObjectId: isObjectId,
    listDocuments: listDocuments,
    getOne: getOne,
    given: given,
    requireString: requireString,
    optionalString: optionalString
};
