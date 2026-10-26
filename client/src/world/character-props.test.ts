// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {Character} from './character';
import {buildMarshmallow} from './campfire';

afterEach(()=>vi.restoreAllMocks());
function seatedRoaster(yaw: number) {
  vi.spyOn(Character.prototype,'setLook').mockImplementation(()=>{});
  const noop: unknown=new Proxy(()=>noop,{get:(_t,k)=>k==='measureText'?()=>({width:0}):noop,set:()=>true,apply:()=>noop});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(noop as never);
  const c=new Character('roaster','Roaster');
  const rig=c as unknown as {model:THREE.Group;bones:Map<string,THREE.Object3D>};
  rig.model=new THREE.Group();c.body.add(rig.model);
  const add=(name:string,parent:THREE.Object3D,x:number,y:number,z:number)=>{
    const bone=new THREE.Object3D();bone.position.set(x,y,z);parent.add(bone);rig.bones.set(name,bone);return bone;
  };
  add('Head',rig.model,0,.62,0);add('spine_03',rig.model,0,.44,0);
  const shoulder=add('upperarm_l',rig.model,.1,.47,0);
  const elbow=add('lowerarm_l',shoulder,0,-.14,0);
  const wrist=add('hand_l',elbow,0,-.14,0);
  add('middle_01_l',wrist,0,-.02,.01);
  c.body.rotation.y=yaw;c.activity='sit';c.opacity=c.targetOpacity=1;
  c.mate=buildMarshmallow();c.mate.scale.setScalar(.75);c.body.add(c.mate);
  return {c,head:rig.bones.get('Head')!};
}

describe('marshmallow eating geometry',()=>{
  for(const yaw of [0,Math.PI/2,Math.PI])it(`keeps the entire skewer in front of the head throughout a bite at yaw ${yaw}`,()=>{
    const {c,head}=seatedRoaster(yaw);
    for(let frame=0;frame<=216;frame++){
      c.sipClock=frame/24;c.update(0);c.root.updateMatrixWorld(true);
      const headLocal=c.body.worldToLocal(head.getWorldPosition(new THREE.Vector3()));
      for(let segment=0;segment<=20;segment++){
        const p=c.mate!.localToWorld(new THREE.Vector3(0,0,.42*segment/20));c.body.worldToLocal(p);
        expect(p.z-headLocal.z).toBeGreaterThanOrEqual(.089999);
      }
      if(frame===24){
        const tip=c.mate!.localToWorld((c.mate!.userData.mouth as THREE.Vector3).clone());c.body.worldToLocal(tip);
        expect(Math.abs(tip.y-headLocal.y)).toBeLessThan(.055);
        expect(c.mate!.rotation.x).toBeCloseTo(-Math.PI/2);
      }
    }
    c.sipClock=4;c.update(0);expect(c.mate!.rotation.x).toBeCloseTo(0);
  });
});
