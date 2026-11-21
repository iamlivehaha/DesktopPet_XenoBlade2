'use strict';
// 将源码打包为 Windows x64 EXE（绿色目录，双击 EXE 直接启动桌宠）。
// 用法：npm run dist
const {packager}=require('@electron/packager');
const path=require('path');

(async()=>{
  const out=path.join(__dirname,'dist');
  await packager({
    dir:__dirname,
    name:'MythraDesktopPet',
    appVersion:'0.2.6',
    platform:'win32',
    arch:'x64',
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
