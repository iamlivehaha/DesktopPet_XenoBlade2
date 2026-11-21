'use strict';

// VPet Core MOVE splits direction, distance/speed and A/B/C animation.
// This adaptation samples a destination in the whole current work area,
// not a small radius around the character and not an off-screen corridor.
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
function planRoam(bounds,work,random=Math.random){
  const margin=8;
  const limits={x:work.x+margin,y:work.y+margin,
    right:work.x+work.width-bounds.width-margin,
    bottom:work.y+work.height-bounds.height-margin};
  if(limits.right<=limits.x||limits.bottom<=limits.y)return null;
  const from={x:clamp(bounds.x,limits.x-margin,limits.right+margin),
    y:clamp(bounds.y,limits.y-margin,limits.bottom+margin)};
  let to;
  for(let i=0;i<12;i++){
    const pt={x:Math.round(limits.x+random()*(limits.right-limits.x)),
      y:Math.round(limits.y+random()*(limits.bottom-limits.y))};
    if(Math.abs(pt.x-from.x)>=Math.min(95,(limits.right-limits.x)/4)){to=pt;break;}
  }
  if(!to)return null;
  const distance=Math.hypot(to.x-from.x,to.y-from.y);
  const speed=118+random()*38; // DIP/s; direction stays fixed until neutral.
  return {from,to,direction:Math.sign(to.x-from.x),duration:Math.max(1350,1000*distance/speed+720)};
}

// Continuous integrated ramp/coast/brake; matched velocity at both joins.
function positionAt(route,elapsed){
  const {duration,from,to}=route;
  const t=clamp(elapsed,0,duration);
  const ramp=Math.min(440,duration*.25);
  const total=duration-ramp;
  let progress;
  if(t<ramp)progress=t*t/(2*ramp*total);
  else if(t<=duration-ramp)progress=(t-ramp/2)/total;
  else progress=1-(duration-t)**2/(2*ramp*total);
  return {x:Math.round(from.x+(to.x-from.x)*progress),
    y:Math.round(from.y+(to.y-from.y)*progress),done:t===duration};
}
module.exports={planRoam,positionAt};
