/*
 * Connect all of your endpoints together here.
 */
var h = require('./helpers');

module.exports = function (app, router) {
    app.use('/api', require('./home.js')(router));
    app.use('/api/users', require('./users.js'));
    app.use('/api/tasks', require('./tasks.js'));

    // Unknown routes
    app.use(function (req, res) {
        h.send(res, 404, 'Endpoint not found', null);
    });

    // Malformed JSON bodies and anything else that slipped through
    app.use(function (err, req, res, next) {
        if (err && (err.type === 'entity.parse.failed' || err.status === 400)) {
            return h.send(res, 400, 'Request body is not valid JSON', null);
        }
        console.error(err);
        h.send(res, 500, 'Something went wrong on the server. Please try again later.', null);
    });
};
