// Proof-of-concept: expand grouped area data to the exact legacy row shape.
window.BTExpandAreaV2=function(pack){
  const expand=(groups)=>groups.flatMap(g=>{
    const base={id:g.id,groupId:g.groupId,tt:g.tt,nqTt:g.nqTt,qdTt:g.qdTt,road:g.road,start:g.start,end:g.end,relation:"main",text:g.text,prices:g.prices,factors:g.factors,conditions:g.conditions,surface:g.surface,...g.meta};
    const branches=g.branches.map(b=>({id:b.id,groupId:g.groupId,tt:b.tt,nqTt:b.nqTt,qdTt:b.qdTt,road:g.road,start:g.start,end:g.end,relation:b.relation,text:b.text,prices:b.prices,factors:b.factors||g.factors,conditions:b.conditions,surface:b.surface,...b.meta}));
    return [base,...branches];
  });
  return {tableNo:pack.tableNo,area:pack.area,nonAgricultural:expand(pack.nonAgricultural),agricultural:expand(pack.agricultural)};
};
