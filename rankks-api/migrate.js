const {queryAll}=require("./src/db"); queryAll("ALTER TABLE player_attributes ADD COLUMN IF NOT EXISTS profile_path TEXT").then(()=>console.log("Done")).catch(console.error)
