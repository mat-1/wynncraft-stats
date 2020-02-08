const axios = require('axios');
require('axios-debug-log')

const credentials = require('../credentials.json');
const tableify = require('@tillhub/tableify');
const _ = require('lodash');
const helper = require('./helper');

const Hypixel = axios.create({
    baseURL: 'https://api.hypixel.net/'
});

module.exports = (app, db) => {
    app.get('/api/:player/profiles', async (req, res) => {
        try{
            let playerResponse = await Hypixel.get('player', {
                params: { key: credentials.hypixel_api_key, name: req.params.player }, timeout: 5000
            });

            const skyBlockProfiles = playerResponse.data.player.stats.SkyBlock.profiles;

            let profiles = [];

            for(let profile in skyBlockProfiles){
                skyBlockProfiles[profile].members = await helper.fetchMembers(profile, db);

                if('html' in req.query)
                    skyBlockProfiles[profile].members = skyBlockProfiles[profile].members.join(", ");

                profiles.push(skyBlockProfiles[profile]);
            }

            if('html' in req.query){
                res.send(tableify(profiles, { showHeaders: false }));
            }else{
                res.json(profiles);
            }
        }catch(e){
            console.error(e);

            res.set('Content-Type', 'text/plain');
            res.status(500).send('Something went wrong');
        }
    });

    app.get('/api/:player/:profile/minions', async (req, res) => {
        try{
            let profileResponse = await getProfile(req);

            let minions = [];

            let coopMembers = profileResponse.data.profile.members;

            for(const member in coopMembers){
                if(!('crafted_generators' in coopMembers[member]))
                    continue;

                for(const minion of coopMembers[member].crafted_generators){
                    const minionName = minion.replace(/(_[0-9]+)/g, '');

                    const minionLevel = parseInt(minion.split("_").pop());

                    if(minions.filter(a => a.minion == minionName).length == 0)
                        minions.push({ minion: minionName, level: minionLevel });

                    let minionObject = minions.filter(a => a.minion == minionName)[0];

                    if(minionObject.level < minionLevel)
                        minionObject.level = minionLevel;
                }
            }

            if('html' in req.query)
                res.send(tableify(minions, { showHeaders: false }));
            else
                res.json(minions);
        }catch(e){
            console.error(e);

            res.set('Content-Type', 'text/plain');
            res.status(500).send('Something went wrong');
        }
    });
}
