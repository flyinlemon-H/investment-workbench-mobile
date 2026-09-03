'use strict';
// Fixed SDK versions and lockfile; only Auth and database requests are used.
const fs=require('node:fs'),path=require('node:path');
const licenses=[...['supabase-js','auth-js','functions-js','postgrest-js','realtime-js','storage-js'].map(name=>`@supabase/${name}/LICENSE`),
  '@supabase/phoenix/LICENSE.md','iceberg-js/LICENSE','tslib/LICENSE.txt','tslib/CopyrightNotice.txt'];
const notices=licenses.map(file=>file+'\n'+fs.readFileSync(path.join(__dirname,'../node_modules',file),'utf8')).join('\n\n');
require('esbuild').buildSync({
  stdin:{contents:"export { createClient } from '@supabase/supabase-js';",resolveDir:require('node:path').resolve(__dirname,'..')},
  bundle:true,minify:true,platform:'browser',format:'iife',globalName:'UniverseSupabaseSdk',
  banner:{js:'/*! Third-party notices\n'+notices.replace(/\*\//g,'* /')+' */'},
  target:['safari15'],legalComments:'inline',outfile:require('node:path').join(__dirname,'../src/vendor/supabase-client.js')
});
