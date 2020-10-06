const tableify = require('@tillhub/tableify');
const _ = require('lodash');
const helper = require('./helper');
const { getId } = helper;
const lib = require('./lib');
const constants = require('./constants');
const cors = require('cors');

function handleError(e, res){
    console.error(e);

    res.set('Content-Type', 'text/plain');
    res.status(500).send('Something went wrong');
}

module.exports = (app, db) => {
    const productInfo = {};

    async function init(){
    }

    const initPromise = init();

}
