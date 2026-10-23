require('dotenv').config({quiet:true});
const {db}=require('../server/db');const master=process.env.SETTINGS_ENCRYPTION_KEY;
const result=require('../server/secret-rotation').rotate(db,master,master,{apply:process.argv.includes('--apply')});
db.close();console.log(JSON.stringify(result));
