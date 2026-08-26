'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const wrapper=path.join(root,'scripts','run_daily_market_update_and_publish.ps1');
const registration=path.join(root,'scripts','register_daily_market_update_task.ps1');
const windowsPowerShell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');

function runPowerShell(script,args=[]){
  return spawnSync(windowsPowerShell,['-NoProfile','-ExecutionPolicy','Bypass','-File',script,...args],{cwd:root,encoding:'utf8'});
}

test('scheduled wrapper remains ASCII-only and resolves the real non-ASCII source path under Windows PowerShell 5.1',()=>{
  const bytes=fs.readFileSync(wrapper);
  assert.equal([...bytes].every(byte=>byte<128),true);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-wrapper-preflight-'));
  const log=path.join(temp,'preflight.log');
  try{
    const result=runPowerShell(wrapper,['-PreflightOnly','-LogPath',log]);
    assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
    const output=fs.readFileSync(log,'utf8');
    assert.match(output,/sourceRunnerPreflight=found/);
    assert.match(output,/finalStatus=success exitCode=0 mode=preflight/);
    assert.match(output,/run_daily_market_update_with_universe\.ps1/);
    assert.match(output,/sourceUpdaterPreflight=found/);
    assert.match(output,/universeInbox=.*investment-workbench-mobile-sync[\\/]inbox/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('missing source updater fails clearly and leaves early diagnostics',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-wrapper-missing-'));
  const missingRoot=path.join(temp,'missing-source');
  const log=path.join(temp,'failure.log');
  try{
    const result=runPowerShell(wrapper,['-PreflightOnly','-SourceRoot',missingRoot,'-LogPath',log]);
    assert.equal(result.status,1,`${result.stdout}\n${result.stderr}`);
    const output=fs.readFileSync(log,'utf8');
    assert.match(output,/wrapperStart=/);
    assert.match(output,/resolvedSourceRoot=/);
    assert.match(output,/sourceUpdaterPreflight=missing/);
    assert.match(output,/finalStatus=failed exitCode=1/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('authoritative task registration describes the intended wrapper architecture and scheduler settings',()=>{
  const result=runPowerShell(registration,['-DescribeOnly']);
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  const description=JSON.parse(result.stdout);
  assert.equal(description.taskName,'InvestmentWorkbench-DailyMarketUpdate');
  assert.equal(description.executable,windowsPowerShell);
  assert.match(description.arguments,/run_daily_market_update_and_publish\.ps1" -UniverseInbox ".*investment-workbench-mobile-sync\\inbox"$/);
  assert.match(description.universeInbox,/investment-workbench-mobile-sync[\\/]inbox$/);
  assert.equal(description.workingDirectory,root);
  assert.equal(description.schedule,'Monday-Friday 16:30');
  assert.equal(description.enabled,true);
  assert.equal(description.startWhenAvailable,true);
  assert.equal(description.multipleInstances,'IgnoreNew');
  assert.equal(description.executionTimeLimit,'PT2H');
  assert.equal(description.disallowStartIfOnBatteries,true);
  assert.equal(description.stopIfGoingOnBatteries,true);
  assert.equal(description.wakeToRun,false);
});

test('task registration can reproduce a scheduler-context no-push acceptance action',()=>{
  const result=runPowerShell(registration,['-DescribeOnly','-PublishDryRun']);
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  const description=JSON.parse(result.stdout);
  assert.match(description.arguments,/run_daily_market_update_and_publish\.ps1" -UniverseInbox ".*investment-workbench-mobile-sync\\inbox" -PublishDryRun$/);
});
