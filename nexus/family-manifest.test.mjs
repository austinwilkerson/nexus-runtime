// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {writeFamilyManifest} from './family-manifest.mjs';
import {project} from './inputs.mjs';
import {fileHash} from './ci/provenance.mjs';
import {stageSdkNotices,sdkNoticeNames} from './sdk-notices.mjs';
const identity={family:'nexus',sourceRepository:'domsvoboda/nexus-runtime',sourceCommit:'a'.repeat(40),sourceLockSha256:'b'.repeat(64)};
const x64Identity={...identity,arch:'x64'};
const armIdentity={...identity,arch:'arm64'};
const prefixes={x64:'files/share/default_pfx',arm64:'files/share/default_pfx_arm64'};
const bins={x64:'files/bin',arm64:'files/bin-arm64'};
const peArchs={x64:['x86_64','i386'],arm64:['aarch64','x86_64','i386']};
const criticalFiles=arch=>[`${bins[arch]}/wine`,`${bins[arch]}/wineserver`,`${bins[arch]}/wine.nexus-original`,
 ...['PlayFabGameSave.dll','gaming-services-version.exe','package-registration.exe'].map(n=>'files/share/xodus-nexus/compat/'+n),
 ...peArchs[arch].flatMap(cpu=>['xgameruntime.dll','winhttp.dll','libnghttp2.dll'].map(n=>`files/lib/wine/${cpu}-windows/${n}`))];
// Write one real target layout: ARM64 has bin-arm64 and default_pfx_arm64, and
// the assembled metadata names that layout; x64 keeps its historical layout.
async function fixture(fn,{arch='x64'}={}){
 const root=await fs.mkdtemp(path.join(project,'../.family-fixture-'));
 try{
  for(const name of ['proton',...criticalFiles(arch)]){const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,name,{mode:0o755});}
  await fs.chmod(path.join(root,'proton'),0o755);
  await fs.mkdir(path.join(root,prefixes[arch],'dosdevices'),{recursive:true});
  const metadata={schema:1,sourceGraph:{proton:identity.sourceCommit},sourceLockSha256:identity.sourceLockSha256,...(arch==='arm64'?{targetArchitecture:'arm64',binDirectory:bins.arm64,defaultPrefix:prefixes.arm64}:{})};
  await fs.writeFile(path.join(root,'XODUS_NEXUS_PATCH.json'),JSON.stringify(metadata));
  await fn(root,metadata);
 }finally{await fs.rm(root,{recursive:true,force:true});}
}
test('family manifest inventories actual payload and exact template mapping without activation',()=>fixture(async root=>{
 await fs.symlink('/',path.join(root,'files/share/default_pfx/dosdevices/z:'));
 await fs.symlink('wine.nexus-original',path.join(root,'files/bin/internal-link'));
 const receipt=await writeFamilyManifest(root,x64Identity),manifest=JSON.parse(await fs.readFile(path.join(root,'nexus-family.json'),'utf8'));
 assert.equal(manifest.buildId,receipt.buildId);assert.match(receipt.manifestSha256,/^[a-f0-9]{64}$/);
 // The x64 receipt keeps its historical arch and inventory exactly.
 assert.equal(manifest.arch,'x64');assert.equal(receipt.arch,'x64');assert.equal(manifest.family,'nexus');assert.equal(manifest.prefixSchema,1);
 assert.equal(manifest.symlinks['files/share/default_pfx/dosdevices/z:'],'/');
 assert.equal(manifest.symlinks['files/bin/internal-link'],'wine.nexus-original');
 assert.ok(manifest.files.proton);assert.ok(!('nexus-family.json' in manifest.files));
 await assert.rejects(fs.access(path.join(root,'current.json')));
 await assert.rejects(writeFamilyManifest(root,x64Identity),/already exists/);
}));
test('staged SDK notices are inventoried before the managed family manifest',()=>fixture(async root=>{
 await stageSdkNotices(root,project);
 await assert.rejects(fs.access(path.join(root,'nexus-family.json')));
 const receipt=await writeFamilyManifest(root,x64Identity),written=JSON.parse(await fs.readFile(path.join(root,'nexus-family.json'),'utf8'));
 assert.equal(written.buildId,receipt.buildId);
 for(const name of sdkNoticeNames){
  const relative='files/share/doc/nexus-runtime/'+name;
  assert.equal(written.files[relative],await fileHash(path.join(project,'licenses',name)));
 }
 const source=await fs.readFile(new URL('./assemble-runtime.mjs',import.meta.url),'utf8');
 assert.ok(source.indexOf('await stageSdkNotices(runtime,project);') < source.indexOf('writeFamilyManifest('));
}));

test('manifest creation rejects unrelated external links and missing launch components',()=>fixture(async root=>{
 await fs.symlink('/',path.join(root,'escape'));
 await assert.rejects(writeFamilyManifest(root,x64Identity),/External/);
 await fs.unlink(path.join(root,'escape'));await fs.unlink(path.join(root,'files/bin/wineserver'));
 await assert.rejects(writeFamilyManifest(root,x64Identity),/incomplete/);
 await assert.rejects(fs.access(path.join(root,'nexus-family.json')));
}));
test('manifest binds source metadata and refuses unexecutable or redirected launchers',()=>fixture(async root=>{
 await assert.rejects(writeFamilyManifest(root,{...x64Identity,sourceCommit:'c'.repeat(40)}),/disagrees/);
 await fs.chmod(path.join(root,'proton'),0o644);await assert.rejects(writeFamilyManifest(root,x64Identity));
 await fs.chmod(path.join(root,'proton'),0o755);await fs.rename(path.join(root,'proton'),path.join(root,'proton-real'));await fs.symlink('proton-real',path.join(root,'proton'));
 await assert.rejects(writeFamilyManifest(root,x64Identity),/incomplete/);
}));
test('per-target assembly writes its own real-arch receipt and a variant cannot write a Standard receipt',async()=>{
 const source=await fs.readFile(new URL('./assemble-runtime.mjs',import.meta.url),'utf8');
 assert.match(source,/arch:target\.name==='arm64'\?'arm64':'x64'/);
 assert.match(source,/const familyReceipt=inputs\.variant\?undefined:await writeFamilyManifest\(/);
 assert.doesNotMatch(source,/legacy experimental path/);
});
test('ARM64 family manifest inventories bin-arm64, the ARM64 prefix and all three PE directories',()=>fixture(async root=>{
 await fs.symlink('/',path.join(root,prefixes.arm64+'/dosdevices/z:'));
 const receipt=await writeFamilyManifest(root,armIdentity),manifest=JSON.parse(await fs.readFile(path.join(root,'nexus-family.json'),'utf8'));
 assert.equal(manifest.arch,'arm64');assert.equal(receipt.arch,'arm64');assert.equal(manifest.buildId,receipt.buildId);
 assert.equal(manifest.symlinks[prefixes.arm64+'/dosdevices/z:'],'/');
 for(const cpu of peArchs.arm64)for(const name of ['xgameruntime.dll','winhttp.dll','libnghttp2.dll'])assert.ok(manifest.files[`files/lib/wine/${cpu}-windows/${name}`],cpu+'/'+name);
 for(const name of ['files/bin-arm64/wine','files/bin-arm64/wineserver','files/bin-arm64/wine.nexus-original'])assert.ok(name in manifest.files,name);
 assert.ok(!Object.hasOwn(manifest.files,'files/bin/wine'),'the ARM64 receipt must not claim the x64 bin directory');
 await assert.rejects(fs.access(path.join(root,'current.json')));
},{arch:'arm64'}));
test('ARM64 receipt fails closed on an x64 relabel, a missing ARM64 binary or an unknown arch',()=>fixture(async root=>{
 // A real x64 tree can never be labelled ARM64.
 await assert.rejects(writeFamilyManifest(root,armIdentity),/disagrees with the assembled runtime/);
 await assert.rejects(writeFamilyManifest(root,{...identity,arch:'aarch64'}),/x64 or arm64/);
 await assert.rejects(writeFamilyManifest(root,identity),/x64 or arm64/);
 // ARM64 metadata over an x64 payload is still incomplete.
 await fs.writeFile(path.join(root,'XODUS_NEXUS_PATCH.json'),JSON.stringify({schema:1,sourceGraph:{proton:identity.sourceCommit},sourceLockSha256:identity.sourceLockSha256,targetArchitecture:'arm64'}));
 await assert.rejects(writeFamilyManifest(root,armIdentity),/incomplete/);
 await assert.rejects(fs.access(path.join(root,'nexus-family.json')));
}));
test('ARM64 receipt requires every ARM64-critical binary',()=>fixture(async root=>{
 await fs.unlink(path.join(root,'files/lib/wine/i386-windows/winhttp.dll'));
 await assert.rejects(writeFamilyManifest(root,armIdentity),/incomplete: files\/lib\/wine\/i386-windows\/winhttp\.dll/);
 await fs.unlink(path.join(root,'files/bin-arm64/wine.nexus-original'));
 await assert.rejects(writeFamilyManifest(root,armIdentity),/incomplete/);
 await assert.rejects(fs.access(path.join(root,'nexus-family.json')));
},{arch:'arm64'}));
test('ARM64 receipt refuses prefix template escapes and foreign z: mappings',()=>fixture(async root=>{
 await fs.symlink('/',path.join(root,prefixes.arm64,'dosdevices/z:'));
 await fs.mkdir(path.join(root,prefixes.arm64,'drive_c/windows'),{recursive:true});
 await fs.symlink('/etc/passwd',path.join(root,prefixes.arm64,'drive_c/windows/escape-link'));
 await assert.rejects(writeFamilyManifest(root,armIdentity),/External managed payload link: files\/share\/default_pfx_arm64\/drive_c\/windows\/escape-link/);
 await fs.unlink(path.join(root,prefixes.arm64,'drive_c/windows/escape-link'));
 // A z: template mapping is only inert when it lives in the receipt's own prefix.
 await fs.mkdir(path.join(root,'files/share/wine'),{recursive:true});
 await fs.symlink('/',path.join(root,'files/share/wine/foreign-template-drive'));
 await assert.rejects(writeFamilyManifest(root,armIdentity),/External managed payload link: files\/share\/wine\/foreign-template-drive/);
 await assert.rejects(fs.access(path.join(root,'nexus-family.json')));
},{arch:'arm64'}));
