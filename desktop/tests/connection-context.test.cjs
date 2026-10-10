const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const test = require("node:test")
const { configureConnectionContext } = require("../src/connection-context.cjs")

function pathsFixture(root, packaged) {
  const selected = {}
  return configureConnectionContext({
    isPackaged: packaged,
    getPath: (name) => path.join(root, name),
    setPath: (name, value) => { selected[name] = value },
  }, { LOCALAPPDATA: path.join(root, "local") })
}
test("packaged profile preserves historical path while development separates profile and credentials", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-context-"))
  try {
    const installed = pathsFixture(root, true), development = pathsFixture(root, false)
    assert.equal(path.basename(installed.userData), "nacho-panel-runtime")
    assert.equal(path.basename(development.userData), "nacho-panel-runtime-dev")
    assert.notEqual(installed.filePath, development.filePath)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test("real Electron v1 migration, restart, profile loss, and version/path changes retain credentials", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-context-electron-"))
  const electron = path.join(__dirname, "../node_modules/electron/dist/electron.exe")
  const contextModule = path.resolve(__dirname, "../src/connection-context.cjs")
  const storeModule = path.resolve(__dirname, "../src/connection-store.cjs")
  const protectorModule = path.resolve(__dirname, "../src/credential-protector.cjs")
  const helper = path.resolve(__dirname, "../build/credential-protector/nacho-credential-protector.exe")
  const probe = path.join(root, "probe.cjs")
  fs.writeFileSync(probe, `
    const {app,safeStorage}=require("electron"),fs=require("node:fs"),path=require("node:path");
    const {configureConnectionContext}=require(${JSON.stringify(contextModule)});
    const paths=configureConnectionContext({isPackaged:true,getPath:name=>name==="appData"?path.join(__dirname,"roaming"):__dirname,setPath:(name,value)=>app.setPath(name,value)},
      {LOCALAPPDATA:path.join(__dirname,"local")});
    app.whenReady().then(async()=>{
      const {createConnectionStore}=require(${JSON.stringify(storeModule)});
      const {createCredentialProtector}=require(${JSON.stringify(protectorModule)});
      const fixture={serverSource:{mode:"cloud",api:"https://fixture.invalid",key:"real-fixture-key"},auth:{mode:"key",secret:"real-fixture-login"},locked:true};
      if(process.argv[2]==="seed-v1"){
        const encrypted=safeStorage.encryptString(JSON.stringify(fixture));
        fs.mkdirSync(paths.dataDirectory,{recursive:true});
        fs.writeFileSync(paths.filePath,JSON.stringify({version:1,ciphertext:encrypted.toString("base64")}));
      }
      const result=createConnectionStore({safeStorage,filePath:paths.filePath,protector:createCredentialProtector(${JSON.stringify(helper)})}).get();
      process.stdout.write(JSON.stringify({persisted:result.persisted,matched:JSON.stringify(result.snapshot)===JSON.stringify(fixture),version:JSON.parse(fs.readFileSync(paths.filePath)).version}));
      app.quit();
    }).catch(e=>{console.error(e.code||e.message);app.exit(1)});
  `)
  function run(mode) {
    const result = spawnSync(electron, [probe, mode], { encoding: "utf8", timeout: 30000, windowsHide: true })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.deepEqual(JSON.parse(result.stdout.trim()), { persisted: true, matched: true, version: 2 })
  }
  try {
    run("seed-v1")
    run("restart")
    const state = path.join(root, "roaming/nacho-panel-runtime/Local State")
    fs.renameSync(state, `${state}.fixture-before`)
    run("read-without-profile-key")
    const disk = fs.readFileSync(path.join(root, "local/NachoPanel/connection-secrets.json"), "utf8")
    assert.doesNotMatch(disk, /real-fixture-key|real-fixture-login|fixture\.invalid/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
