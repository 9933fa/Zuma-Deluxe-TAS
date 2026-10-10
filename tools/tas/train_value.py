# train the value MLP: python train_value.py out_model.json data1.jsonl [data2.jsonl ...]
import json, sys, random
import numpy as np, torch, torch.nn as nn
out = sys.argv[1]
rows = []
for f in sys.argv[2:]:
    for line in open(f):
        rows.append(json.loads(line))
X = np.array([r['x'] for r in rows], np.float32); Y = np.array([r['y'] for r in rows], np.float32)
labs = sorted(set(r['lab'] for r in rows)); random.seed(0); random.shuffle(labs)
val = set(labs[:len(labs) // 5])
vm = np.array([r['lab'] in val for r in rows])
mu = X.mean(0); sd = X.std(0) + 1e-3; ymu = Y.mean(); ysd = Y.std()
Xn = (X - mu) / sd; Yn = (Y - ymu) / ysd
H = 64
net = nn.Sequential(nn.Linear(X.shape[1], H), nn.ReLU(), nn.Linear(H, H), nn.ReLU(), nn.Linear(H, 1))
opt = torch.optim.Adam(net.parameters(), lr=2e-3, weight_decay=1e-5)
xt = torch.tensor(Xn[~vm]); yt = torch.tensor(Yn[~vm]); xv = torch.tensor(Xn[vm]); yv = torch.tensor(Yn[vm])
lossf = nn.SmoothL1Loss(beta=0.3)
best = (1e9, None)
for ep in range(400):
    perm = torch.randperm(len(xt))
    for i in range(0, len(xt), 256):
        idx = perm[i:i + 256]
        opt.zero_grad(); l = lossf(net(xt[idx]).squeeze(1), yt[idx]); l.backward(); opt.step()
    if ep % 20 == 19:
        with torch.no_grad():
            pv = net(xv).squeeze(1); mae = (pv - yv).abs().mean().item() * ysd
            pt = net(xt).squeeze(1); maet = (pt - yt).abs().mean().item() * ysd
        print(ep, 'train MAE', round(maet, 1), 'val MAE', round(mae, 1))
        if mae < best[0]: best = (mae, [p.detach().clone() for p in net.parameters()])
# final: fit on all data with the same epochs? keep best-val weights
for p, b in zip(net.parameters(), best[1]): p.data.copy_(b)
layers = []
mods = [m for m in net if isinstance(m, nn.Linear)]
for m in mods: layers.append({'W': m.weight.detach().numpy().tolist(), 'b': m.bias.detach().numpy().tolist()})
json.dump({'mu': mu.tolist(), 'sd': sd.tolist(), 'ymu': float(ymu), 'ysd': float(ysd), 'layers': layers}, open(out, 'w'))
print('saved', out, 'best val MAE', round(best[0], 1), 'baseline MAE (mean)', round(float(np.abs(Y[vm] - Y[~vm].mean()).mean()), 1))
