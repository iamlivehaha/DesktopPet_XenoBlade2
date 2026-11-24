'use strict';
// 将源码打包为 Windows x64 EXE（绿色目录，双击 EXE 直接启动桌宠）。
// 用法：npm run dist
const {packager}=require('@electron/packager');
const fs=require('fs');
const path=require('path');

const ELECTRON_VERSION='39.8.10';

function findCachedElectronZip(){
  // electron-builder / @electron/get 的默认下载缓存目录。命中时离线打包，
  // 避免网络不通时卡在下载；其他机器无缓存时仍交给 packager 联网获取。
  const roots=[
    process.env.ELECTRON_CACHE,
    path.join(process.env.LOCALAPPDATA||'', 'electron', 'Cache'),
    path.join(process.env.USERPROFILE||'', '.electron'),
    path.join(process.env.HOME||'', '.electron')
  ].filter(Boolean);
  const zipName='electron-v'+ELECTRON_VERSION+'-win32-x64.zip';
  for(const root of roots){
    for(const dir of [root, path.join(root,'v'+ELECTRON_VERSION)]){
      const p=path.join(dir,zipName);
      try{if(fs.statSync(p).size>1024*1024)return dir;}catch{}
    }
  }
  return null;
}

(async()=>{
  const out=path.join(__dirname,'dist');
  const zipDir=findCachedElectronZip();
  if(zipDir)console.log('使用本地 Electron 缓存：'+zipDir);
  await packager({
    dir:__dirname,
    name:'MythraDesktopPet',
    appVersion:'0.2.7',
    electronVersion:ELECTRON_VERSION,
    platform:'win32',
    arch:'x64',
    ...(zipDir?{electronZipDir:zipDir}:{}),
    out,
    overwrite:true,
    prune:true,
    asar:true,
    ignore:[
      /(^|\/)(dist|dist-pack|qa|\.git|node_modules)(\/|$)/,
      /^_verify_/,
      /^_pack\.cjs$/,
      /^_contact_sheet/
    ]
  });
  console.log('打包完成：'+path.join(out,'MythraDesktopPet-win32-x64','MythraDesktopPet.exe'));
})().catch(e=>{console.error('打包失败：'+e.message);process.exit(1);});
