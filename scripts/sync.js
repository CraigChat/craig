const { token, applicationID } = require('../config.json');
const commands = require('./commands.json');
const request = require('snekfetch');
const { inspect } = require('util');

const deleteCommands = process.argv.includes('-d');
const guild = process.argv.filter(v => v !== '-d')[2];

if (!token || !applicationID) throw new Error("No ID or token");

request.put(`https://discord.com/api/v9/applications/${applicationID}${guild ? `/guilds/${guild}` : ''}/commands`)
  .set('Authorization', `Bot ${token}`)
  .send(deleteCommands ? [] : commands)
  .then(r => console.log(r.status, inspect(r.body, { depth: 20 })));

