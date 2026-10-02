import json,sys,math
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as P
zones=[]
for fn in sys.argv[2:]: zones+=json.load(open(fn))['features']
src=json.load(open('src_b3.json'))
def rings(g):
    if g['type']=='Polygon': return [g['coordinates'][0]]
    if g['type']=='MultiPolygon': return [p[0] for p in g['coordinates']]
    return []
def lines(g):
    if g['type']=='LineString': return [g['coordinates']]
    if g['type']=='MultiLineString': return g['coordinates']
    return []
n=len(zones); cols=4; rows=math.ceil(n/cols)
fig,axs=plt.subplots(rows,cols,figsize=(cols*5,rows*5))
allsrc=[x for k in ('hwy99','hwy3','hwy1','hwy7','callaghan','hemlock','sylv','texada','silver','sakwi','eureka') for x in src[k]]
for ax,z in zip(axs.flat,zones):
    rs=rings(z['geometry'])
    xs=[c[0] for r in rs for c in r]; ys=[c[1] for r in rs for c in r]
    x0,x1,y0,y1=min(xs),max(xs),min(ys),max(ys); pad=max(x1-x0,y1-y0)*0.15+0.005
    for r in rs: ax.add_patch(P(r,closed=True,fc=(1,0,0,0.25),ec='red',lw=0.6))
    for x in allsrc:
        for l in lines(x['g']):
            if any(x0-pad<c[0]<x1+pad and y0-pad<c[1]<y1+pad for c in l[::3]): ax.plot([c[0] for c in l],[c[1] for c in l],color='k',lw=0.5)
    for m in src['muni']+src['parks']:
        for r in rings(m['g']): ax.plot([c[0] for c in r],[c[1] for c in r],color='blue',lw=0.4)
    ax.set_xlim(x0-pad,x1+pad); ax.set_ylim(y0-pad,y1+pad); ax.set_aspect(1/math.cos(math.radians((y0+y1)/2)))
    ax.set_title(z['properties']['id']+' '+z['properties']['name'][:30],fontsize=8); ax.tick_params(labelsize=5)
for ax in list(axs.flat)[n:]: ax.axis('off')
plt.tight_layout(); plt.savefig(sys.argv[1],dpi=70)
