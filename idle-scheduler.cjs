'use strict';
class IdleScheduler {
  constructor(config,{random=Math.random,enabled=true}={}) {
    this.config=config;this.random=random;this.enabled=enabled;this.last=null;
    this.lastInput=-Infinity;this.next=this.delay();this.counts={};    this.bag=[];
    this.persona='mythra';this.actionKeys=null;
  }
  setPersona(persona,now,controller){
    if(persona===this.persona)return;
    this.persona=persona;this.bag=[];
    if(now!==undefined&&controller)this.interact(now,controller);
  }
  setActionKeys(keys,now,controller){
    this.actionKeys=keys?new Set(keys):null;this.bag=[];
    if(now!==undefined&&controller)this.interact(now,controller);
  }
  delay(){return this.config.minDelayMs+this.random()*(this.config.maxDelayMs-this.config.minDelayMs);}
  interact(now,controller){this.lastInput=now;this.next=now+this.delay();controller.release('autonomy');}
  setEnabled(value,now,controller){this.enabled=Boolean(value);this.interact(now,controller);}
  refill(available){
    this.bag=available.slice();
    for(let i=this.bag.length-1;i>0;i--){
      const j=Math.floor(this.random()*(i+1));
      [this.bag[i],this.bag[j]]=[this.bag[j],this.bag[i]];
    }
    if(this.bag.length>1&&this.bag[0]===this.last){
      const j=1+Math.floor(this.random()*(this.bag.length-1));
      [this.bag[0],this.bag[j]]=[this.bag[j],this.bag[0]];
    }
  }
  tick(now,controller,interacting=false){
    if(!this.enabled||interacting||controller.action!=='idle'||now-this.lastInput<this.config.quietAfterInputMs||now<this.next)return null;
    const available=[...new Set(this.config.actions.map(r=>r.action).filter(a=>{
     if(this.actionKeys&&!this.actionKeys.has(a))return false;
     const d=controller.definitions[a];
     return d&&(!d.personas||d.personas.includes(this.persona));
    }))];
    this.bag=this.bag.filter(a=>available.includes(a));
    if(!this.bag.length)this.refill(available);
    if(!this.bag.length)return null;
    // A turn is counted when it starts, even if the user interrupts it.
    // Interaction and disabling idle never reset or otherwise reroll the bag.
    const chosen=this.bag.shift();
    this.last=chosen;this.next=now+this.delay();this.counts[chosen]=(this.counts[chosen]||0)+1;
    controller.request('autonomy',chosen,5);return chosen;
  }
}
if(typeof module!=='undefined')module.exports={IdleScheduler};
if(typeof window!=='undefined')window.IdleScheduler=IdleScheduler;
