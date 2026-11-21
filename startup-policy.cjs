'use strict';
function startupMode({packaged,args}){
 if(args.includes('--self-test'))return 'self-test';
 if(args.includes('--verify-startup')||args.includes('--probe-startup'))return 'startup-check';
 if(args.includes('--preview'))return 'preview';
 if(packaged||args.includes('--desktop'))return 'desktop';
 return 'preview';
}
function clampPosition(bounds,area){
 return {x:Math.round(Math.max(area.x,Math.min(bounds.x,area.x+area.width-bounds.width))),
  y:Math.round(Math.max(area.y,Math.min(bounds.y,area.y+area.height-bounds.height)))};
}
module.exports={startupMode,clampPosition};
