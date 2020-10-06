const fs = require('fs');
const path = require('path');
const nbt = require('prismarine-nbt');
const util = require('util');
const mcData = require("minecraft-data")("1.8.9");
const _ = require('lodash');
const constants = require('./constants');
const helper = require('./helper');
const { getId } = helper;
const axios = require('axios');
const moment = require('moment');
const { v4 } = require('uuid');
const retry = require('async-retry');



const Wynncraft = axios.create({
	baseURL: 'https://api.wynncraft.com/v2/'
});


const { SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS } = require('constants');

const parseNbt = util.promisify(nbt.parse);

const rarity_order = ['special', 'mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];

const petTiers = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

const MAX_SOULS = 209;

function replaceAll(target, search, replacement){
    return target.split(search).join(replacement);
}

function getMinMax(profiles, min, ...path){
    let output = null;

    const compareValues = profiles.map(a => helper.getPath(a, ...path)).filter(a => !isNaN(a));

    if(compareValues.length == 0)
        return output;

    if(min)
        output = Math.min(...compareValues);
    else
        output = Math.max(...compareValues);

    if(isNaN(output))
        return null;

    return output;
}

function getMax(profiles, ...path){
    return getMinMax(profiles, false, ...path);
}

function getMin(profiles, ...path){
    return getMinMax(profiles, true, ...path);
}

function getAllKeys(profiles, ...path){
    return _.uniq([].concat(...profiles.map(a => _.keys(helper.getPath(a, ...path)))));
}

function getXpByLevel(level, runecrafting){
    const output = {
        level: Math.min(level, 50),
        xpCurrent: 0,
        xpForNext: null,
        progress: 0.05
    }

    let xp_table = runecrafting ? constants.runecrafting_xp : constants.leveling_xp;

    if(isNaN(level))
        return 0;

    let xpTotal = 0;

    let maxLevel = Object.keys(xp_table).sort((a, b) => Number(a) - Number(b)).map(a => Number(a)).pop();

    output.maxLevel = maxLevel;

    for(let x = 1; x <= level; x++)
        xpTotal += xp_table[x];

    output.xp = xpTotal;

    if(level >= maxLevel)
        output.progress = 1;
    else
        output.xpForNext = xp_table[level + 1];

    return output;
}

function getLevelByXp(xp, type = 'regular'){
    let xp_table;

    switch(type){
        case 'runecrafting':
            xp_table = constants.runecrafting_xp;
            break;
        case 'dungeon':
            xp_table = constants.dungeon_xp;
            break;
        default:
            xp_table = constants.leveling_xp; 
    }

    if(isNaN(xp)){
        return {
            xp: 0,
            level: 0,
            xpCurrent: 0,
            xpForNext: xp_table[1],
            progress: 0
        };
    }

    let xpTotal = 0;
    let level = 0;

    let xpForNext = Infinity;

    let maxLevel = Object.keys(xp_table).sort((a, b) => Number(a) - Number(b)).map(a => Number(a)).pop();

    for(let x = 1; x <= maxLevel; x++){
        xpTotal += xp_table[x];

        if(xpTotal > xp){
            xpTotal -= xp_table[x];
            break;
        }else{
            level = x;
        }
    }

    let xpCurrent = Math.floor(xp - xpTotal);

    if(level < maxLevel)
        xpForNext = Math.ceil(xp_table[level + 1]);

    let progress = Math.max(0, Math.min(xpCurrent / xpForNext, 1));

    return {
        xp,
        level,
        maxLevel,
        xpCurrent,
        xpForNext,
        progress
    };
}

function getSlayerLevel(slayer, slayerName){
    let { xp, claimed_levels } = slayer;

    let currentLevel = 0;
    let progress = 0;
    let xpForNext = 0;

    const maxLevel = Math.max(...Object.keys(constants.slayer_xp[slayerName]));

    for(const level_name in claimed_levels){
        const level = parseInt(level_name.split("_").pop());

        if(level > currentLevel)
            currentLevel = level;
    }

    if(currentLevel < maxLevel){
        const nextLevel = constants.slayer_xp[slayerName][currentLevel + 1];

        progress = xp / nextLevel;
        xpForNext = nextLevel;
    }else{
        progress = 1;
    }

    return { currentLevel, xp, maxLevel, progress, xpForNext };
}

function getPetLevel(pet){
    const rarityOffset = constants.pet_rarity_offset[pet.rarity];
    const levels = constants.pet_levels.slice(rarityOffset, rarityOffset + 99);

    const xpMaxLevel = levels.reduce((a, b) => a + b, 0)
    let xpTotal = 0;
    let level = 1;

    let xpForNext = Infinity;

    for(let i = 0; i < 100; i++){
        xpTotal += levels[i];

        if(xpTotal > pet.exp){
            xpTotal -= levels[i];
            break;
        }else{
            level++;
        }
    }

    let xpCurrent = Math.floor(pet.exp - xpTotal);
    let progress;

    if(level < 100){
        xpForNext = Math.ceil(levels[level - 1]);
        progress = Math.max(0, Math.min(xpCurrent / xpForNext, 1));
    }else{
        level = 100;
        xpCurrent = pet.exp - levels[99];
        xpForNext = 0;
        progress = 1;
    }

    return {
        level,
        xpCurrent,
        xpForNext,
        progress,
        xpMaxLevel
    };
}

function getFairyBonus(fairyExchanges){
    const bonus = Object.assign({}, constants.stat_template);

    bonus.speed = Math.floor(fairyExchanges / 10);

    for(let i = 0; i < fairyExchanges; i++){
        bonus.strength += (i + 1) % 5 == 0 ? 2 : 1;
        bonus.defense += (i + 1) % 5 == 0 ? 2 : 1;
        bonus.health += 3 + Math.floor(i / 2);
    }

    return bonus;
}

function getBonusStat(level, skill, max, incremention){
    let skill_stats = constants.bonus_stats[skill];
    let steps = Object.keys(skill_stats).sort((a, b) => Number(a) - Number(b)).map(a => Number(a));

    let bonus = Object.assign({}, constants.stat_template);

    for(let x = steps[0]; x <= max; x += incremention){
        if(level < x)
            break;

        let skill_step = steps.slice().reverse().find(a => a <= x);

        let skill_bonus = skill_stats[skill_step];

        for(let skill in skill_bonus)
            bonus[skill] += skill_bonus[skill];
    }

    return bonus;
}

// Calculate total health with defense
function getEffectiveHealth(health, defense){
    if(defense <= 0)
        return health;

    return Math.round(health * (1 + defense / 100));
}

async function getBackpackContents(arraybuf){
    let buf = Buffer.from(arraybuf);

    let data = await parseNbt(buf);
    data = nbt.simplify(data);

    let items = data.i;

    for(const [index, item] of items.entries()){
        item.isInactive = true;
        item.inBackpack = true;
        item.item_index = index;
    }

    return items;
}

module.exports = {
    splitWithTail: (string, delimiter, count) => {
        let parts = string.split(delimiter);
        let tail = parts.slice(count).join(delimiter);
        let result = parts.slice(0,count);
        result.push(tail);

        return result;
    },

    getBaseStats: () => {
        return constants.base_stats;
    },

    getLevelByXp: (xp) => {
        let xpTotal = 0;
        let level = 0;

        let maxLevel = Object.keys(constants.leveling_xp).sort((a, b) => Number(a) - Number(b)).map(a => Number(a)).pop();

        for(let x = 1; x <= maxLevel; x++){
            xpTotal += constants.leveling_xp[x];

            if(xp >= xpTotal)
                level = x;
        }

        return level;
    },

    // Get skill bonuses for a specific skill
    getBonusStat: (level, skill, incremention) => {
        let skill_stats = constants.bonus_stats[skill];
        let steps = Object.keys(skill_stats).sort((a, b) => Number(a) - Number(b)).map(a => Number(a));

        let bonus = {
            health: 0,
            defense: 0,
            strength: 0,
            damage_increase: 0,
            speed: 0,
            crit_chance: 0,
            crit_damage: 0,
            intelligence: 0,
            damage_multiplicator: 1
        };

        for(let x = steps[0]; x <= steps[steps.length - 1]; x += incremention){
            if(level < x)
                break;

            let skill_step = steps.slice().reverse().find(a => a <= x);

            let skill_bonus = skill_stats[skill_step];

            for(let skill in skill_bonus)
                bonus[skill] += skill_bonus[skill];
        }

        return bonus;
    },

    getEffectiveHealth: (health, defense) => {
        return getEffectiveHealth(health, defense);
    },

    getMinions: coopMembers => {
        const minions = [];

        const craftedGenerators = [];

        for(const member in coopMembers){
            if(!('crafted_generators' in coopMembers[member]))
                continue;

            craftedGenerators.push(...coopMembers[member].crafted_generators);
        }

        for(const generator of craftedGenerators){
            const split = generator.split("_");

            const minionLevel = parseInt(split.pop());
            const minionName = split.join("_");

            const minion = minions.filter(a => a.id == minionName);

            if(minion.length == 0)
                minions.push(Object.assign({ id: minionName, maxLevel: 0, levels: [minionLevel] }, constants.minions[minionName]));
            else
                minion[0].levels.push(minionLevel);
        }

        for(const minion in constants.minions)
            if(minions.filter(a => a.id == minion).length == 0)
                minions.push(Object.assign({ id: minion, levels: [], maxLevel: 0 }, constants.minions[minion]));

        for(const minion of minions){
            minion.levels = _.uniq(minion.levels.sort((a, b) => a - b));
            minion.maxLevel = minion.levels.length > 0 ? Math.max(...minion.levels) : 0;

            if(!('name' in minion))
                minion.name = _.startCase(_.toLower(minion.id));
        }

        return minions;
    },

    getMinionSlots: minions => {
        let uniqueMinions = 0;

        for(const minion of minions)
            uniqueMinions += minion.levels.length;

        const output = { currentSlots: 5, toNext: 5 };

        const uniquesRequired = Object.keys(constants.minion_slots).sort((a, b) => parseInt(a) - parseInt(b) );

        for(const [index, uniques] of uniquesRequired.entries()){
            if(parseInt(uniques) <= uniqueMinions)
                continue;

            output.currentSlots = constants.minion_slots[uniquesRequired[index - 1]];
            output.toNextSlot = uniquesRequired[index] - uniqueMinions;
            break;
        }

        return output;
    },

    getLevels: async (userProfile, hypixelProfile) => {
        let output = {};

        let skillLevels;
        let totalSkillXp = 0;
        let average_level = 0;

        // Apply skill bonuses
        if(helper.hasPath(userProfile, 'experience_skill_taming')
        || helper.hasPath(userProfile, 'experience_skill_farming')
        || helper.hasPath(userProfile, 'experience_skill_mining')
        || helper.hasPath(userProfile, 'experience_skill_combat')
        || helper.hasPath(userProfile, 'experience_skill_foraging')
        || helper.hasPath(userProfile, 'experience_skill_fishing')
        || helper.hasPath(userProfile, 'experience_skill_enchanting')
        || helper.hasPath(userProfile, 'experience_skill_alchemy')
        || helper.hasPath(userProfile, 'experience_skill_carpentry')
        || helper.hasPath(userProfile, 'experience_skill_runecrafting')){
            let average_level_no_progress = 0;

            skillLevels = {
                taming: getLevelByXp(userProfile.experience_skill_taming || 0),
                farming: getLevelByXp(userProfile.experience_skill_farming || 0),
                mining: getLevelByXp(userProfile.experience_skill_mining || 0),
                combat: getLevelByXp(userProfile.experience_skill_combat || 0),
                foraging: getLevelByXp(userProfile.experience_skill_foraging || 0),
                fishing: getLevelByXp(userProfile.experience_skill_fishing || 0),
                enchanting: getLevelByXp(userProfile.experience_skill_enchanting || 0),
                alchemy: getLevelByXp(userProfile.experience_skill_alchemy || 0),
                carpentry: getLevelByXp(userProfile.experience_skill_carpentry || 0),
                runecrafting: getLevelByXp(userProfile.experience_skill_runecrafting || 0, 'runecrafting'),
            };

            for(let skill in skillLevels){
                if(skill != 'runecrafting' && skill != 'carpentry'){
                    average_level += skillLevels[skill].level + skillLevels[skill].progress;
                    average_level_no_progress += skillLevels[skill].level;

                    totalSkillXp += skillLevels[skill].xp;
                }
            }

            output.average_level = (average_level / (Object.keys(skillLevels).length - 2));
            output.average_level_no_progress = (average_level_no_progress / (Object.keys(skillLevels).length - 2));
            output.total_skill_xp = totalSkillXp;

            output.levels = Object.assign({}, skillLevels);
        }else{
            skillLevels = {
                farming: hypixelProfile.achievements.skyblock_harvester || 0,
                mining: hypixelProfile.achievements.skyblock_excavator || 0,
                combat: hypixelProfile.achievements.skyblock_combat || 0,
                foraging: hypixelProfile.achievements.skyblock_gatherer || 0,
                fishing: hypixelProfile.achievements.skyblock_angler || 0,
                enchanting: hypixelProfile.achievements.skyblock_augmentation || 0,
                alchemy: hypixelProfile.achievements.skyblock_concoctor || 0,
                taming: hypixelProfile.achievements.skyblock_domesticator || 0,
            };

            output.levels = {};

            let skillsAmount = 0;

            for(const skill in skillLevels){
                output.levels[skill] = getXpByLevel(skillLevels[skill]);

                if(skillLevels[skill] < 0)
                    continue;

                skillsAmount++;
                average_level += skillLevels[skill];

                totalSkillXp += output.levels[skill].xp;
            }

            output.average_level = (average_level / skillsAmount);
            output.average_level_no_progress = output.average_level;
            output.total_skill_xp = totalSkillXp;
        }


        const skillNames = Object.keys(output.levels);

        for(const skill of skillNames){
            if(output.levels[skill].xp == null){
                output.levels[skill].rank = 100000;
                continue;
            }

        }


        for(const [index, skill] of skillNames.entries()){
            output.levels[skill].rank = results[index][1];
        }

        return output;
    },

    getProfile: async (paramPlayer, paramClass, options = { cacheOnly: false, waitForLb: false }) => {
			const playerObject = await helper.resolveUsernameOrUuid(paramPlayer)
			const response = await Wynncraft.get(`player/${playerObject.display_name}/stats`)
			const data = response.data.data[0]
			data.uuid = data.uuid.replace(/-/g, '')
			console.log(data.uuid)
			data.skin_data = playerObject.skin_data

			const allClasses = data.classes
			var mainClass = allClasses[0]
			for (const _class of allClasses) {
				if (_class.name == paramClass)
					mainClass = _class
			}
			return {
				player: data,
				allClasses,
				mainClass
			}
    },

}

async function init() {
}

init();
