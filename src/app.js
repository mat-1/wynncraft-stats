const cluster = require('cluster');
const lib = require('./lib');

async function main(){
    const express = require('express');
    const session = require('express-session');
    const bodyParser = require('body-parser');
    const crypto = require('crypto');
    const cors = require('cors');

    const axios = require('axios');
    require('axios-debug-log');

    const retry = require('async-retry');

    const fs = require('fs-extra');

    const path = require('path');
    const util = require('util');

    const credentials = require(path.resolve(__dirname, '../credentials.json'));

    const _ = require('lodash');
    const moment = require('moment-timezone');
    require('moment-duration-format')(moment);

    const helper = require('./helper');
    const constants = require('./constants');
    const { SitemapStream, streamToPromise } = require('sitemap');
    const { createGzip } = require('zlib');
    const twemoji = require('twemoji');

    const CACHE_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days


    const app = express();
    const port = 8080;

    let sitemap;

    app.locals.moment = moment;
    app.use(bodyParser.urlencoded({ extended: true }));
    app.set('view engine', 'ejs');
    app.use(express.static('public', { maxAge: CACHE_DURATION }));

    app.use(session({
			secret: credentials.session_secret,
			resave: false,
			saveUninitialized: false,
    }));

    app.all('/stats/:player/:className?', async (req, res, next) => {
			let paramPlayer = req.params.player.toLowerCase().replace(/[^a-z\d\-\_:]/g, '');
			let paramClass = req.params.className ? req.params.className.toLowerCase() : null;

			const playerUsername = paramPlayer.length == 32 ? await helper.resolveUsernameOrUuid(paramPlayer).display_name : paramPlayer;

			try {
				const { player, allClasses, mainClass } = await lib.getProfile(paramPlayer, paramClass);

				res.render('stats', {
					req,
					player,
					allClasses,
					mainClass,
					_,
					constants,
					helper,
					page: 'stats'
				});
			} catch(e) {
				console.error(e);

				res.render('index', {
					req,
					error: e,
					player: playerUsername,
					helper,
					page: 'index'
				});

				return false;
			}
    });


    app.all('/sitemap.xml', async (req, res, next) => {
        res.header('Content-Type', 'application/xml');
        res.header('Content-Encoding', 'gzip');

        if(sitemap){
            res.send(sitemap);
            return
        }

        try{
            const smStream = new SitemapStream({ hostname: 'https://sky.lea.moe/' });
            const pipeline = smStream.pipe(createGzip());

            const cursor = await db.collection('viewsLeaderboard').find().limit(10000);

            while(await cursor.hasNext()){
                const doc = await cursor.next();

                smStream.write({ url: `/stats/${doc.userInfo.username}` });
            }

            smStream.end();

            streamToPromise(pipeline).then(sm => sitemap = sm);

            pipeline.pipe(res).on('error', (e) => {throw e});
        }catch(e){
            console.error(e)
            res.status(500).end()
        }
    });

    app.all('/favicon.ico', express.static(path.join(__dirname, 'public')));

    app.all('/:player/:profile?', async (req, res, next) => {
			res.redirect(`/stats${req.path}`);
    });

    app.all('/', async (req, res, next) => {
			res.render('index', { error: null, player: null, helper, page: 'index' });
    });

    app.all('*', async (req, res, next) => {
			res
			.status(404)
			.type('txt')
			.send('Not found')
    });

    app.listen(port, '0.0.0.0');
}

main();
