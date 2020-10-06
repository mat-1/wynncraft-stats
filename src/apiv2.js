const helper = require('./helper');
const lib = require('./lib');
const cors = require('cors');
const constants = require('./constants');

function handleError(e, res){
    console.error(e);

    res.status(500).json({
        error: e.toString()
    });
}

module.exports = (app, db) => {
    const initFunction = async () => {
    }

    const init = initFunction();

    setInterval(initFunction, 1000 * 60);
};
