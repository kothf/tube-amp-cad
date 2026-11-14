#!/usr/bin/env python3
"""Ports ngspice's BSIM3v3 and BSIM4 MOSFET models to the engine: writes bsim3.js and bsim4.js.

    python3 scripts/bsim/port.py <ngspice-42>/src/spicelib/devices

c2js.py turns the C into JavaScript line by line (model/instance/size fields to m., h., pParam.,
pointer outputs to returned arrays, gotos to labeled breaks); this script cuts the parts it needs
out of b3set.c/b3temp.c/b3ld.c and b4set.c/b4temp.c/b4geo.c/b4ld.c (the model defaults, the
temperature and size setup, the load's currents and charges, not its matrix stamping) and puts
them into tpl3.js/tpl4.js. Checked against ngspice by tests/bsim-ngspice.mjs.
"""
import os, re, sys, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from c2js import c2js
from params import table
from slim import slim
D = sys.argv[1]
OUT = os.path.join(HERE, '..', '..')

# ---- BSIM3 ----
P = 'BSIM3'
def lines(f, a, b): return '\n'.join(open(f).read().split('\n')[a-1:b])
def find(f, pat, start=1):
    L = open(f).read().split('\n')
    for i in range(start-1, len(L)):
        if re.search(pat, L[i]): return i+1
    raise Exception(pat)
st = lambda s: re.sub(r'\*\s*\(\s*ckt->CKTstate0\s*\+\s*here->BSIM3(\w+)\s*\)', r'h.st_\1', s)
setf, tempf, ldf = D+'/bsim3/b3set.c', D+'/bsim3/b3temp.c', D+'/bsim3/b3ld.c'
# model defaults
a = find(setf, r'Default value Processing'); b = find(setf, r'loop through all the instances') - 1
mdef = c2js(lines(setf, a, b), P)
# instance defaults: from 'perform the parameter defaulting' to 'process source/drain series resistance'
a = find(setf, r'perform the parameter defaulting'); b = find(setf, r'process source/drain series resistance', a) - 1
idef = c2js(lines(setf, a, b), P)
# temp: model part + instance part
a = find(tempf, r'Temp = ckt->CKTtemp'); b = find(tempf, r'^\s*return\s*\(\s*OK\s*\)') - 1
tmp = c2js(lines(tempf, a, b), P)
tmp = tmp.replace('Temp = ckt.temp;', 'Temp = ckt.temp;', 1)
tmp = re.sub(r'for \(here = BSIM3instances\(model\);.*?BSIM3nextInstance\(here\)\)', '', tmp, flags=re.S)
tmp = tmp.rstrip().rstrip('}')  # drop closing brace of the model loop
# load core
a = find(ldf, r'Source/drain junction diode DC model begins'); b = find(ldf, r'^finished:') - 1
core = c2js(st(lines(ldf, a, b)), P)
a = find(ldf, r'if \(ChargeComputationNeeded\)', find(ldf, r'^finished:')); b = find(ldf, r'check convergence', a) - 2
jc = c2js(st(lines(ldf, a, b)), P)
a = find(ldf, r'if \(model->BSIM3capMod == 0\) /\* code merge'); b = find(ldf, r'here->BSIM3cgdo = cgdo;', a)
ov = c2js(st(lines(ldf, a, b)), P)
# declarations of the load function
a = find(ldf, r'^double SourceSatCurrent'); b = find(ldf, r'^int ByPass')
decl = c2js(lines(ldf, a, b), P)
decl = re.sub(r'^let m;$', '', decl, flags=re.M)
# temp declarations
a = find(tempf, r'^double tmp, tmp1'); b = find(tempf, r'^int Size_Not_Found')
tdecl = c2js(lines(tempf, a, b), P)
params = table(D+'/bsim3/b3.c', D+'/bsim3/b3mpar.c', P, 'BSIM3mPTable')
ip = table(D+'/bsim3/b3.c', D+'/bsim3/b3par.c', P, 'BSIM3pTable') if False else None
P3 = ({'mdef': mdef, 'idef': idef, 'tmp': tmp, 'core': core, 'jc': jc, 'ov': ov, 'decl': decl, 'tdecl': tdecl, 'params': params})

d = P3
t = open(os.path.join(HERE, 'tpl3.js')).read()
tmp = d['tmp'].replace('BSIM3checkModel(model, here, ckt)', 'false')
tmp = tmp.replace('m.pSizeDependParamKnot', 'm._knot')
core = d['core']
for k, v in [('/*PARAMS*/', json.dumps(d['params'])), ('/*MDEF*/', d['mdef']), ('/*IDEF*/', d['idef']), ('/*TDECL*/', d['tdecl']), ('/*TMP*/', tmp), ('/*DECL*/', d['decl']), ('/*CORE*/', core), ('/*JC*/', d['jc']), ('/*OV*/', d['ov'])]:
    t = t.replace(k, v)
open(os.path.join(OUT, 'bsim3.js'), 'w').write(slim(t))

# ---- BSIM4 ----
P = 'BSIM4'
def lines(f, a, b): return '\n'.join(open(f).read().split('\n')[a-1:b])
def find(f, pat, start=1):
    L = open(f).read().split('\n')
    for i in range(start-1, len(L)):
        if re.search(pat, L[i]): return i+1
    raise Exception(pat)
st = lambda s: re.sub(r'\*\s*\(\s*ckt->CKTstate0\s*\+\s*here->BSIM4(\w+)\s*\)', r'h.st_\1', s)
def outcalls(s):
    # FUNC(a, b, &x, &(y)) → [x, y] = FUNC(a, b)
    def rep(mo):
        name, args = mo.group(1), mo.group(2)
        parts, depth, cur = [], 0, ''
        for ch in args:
            if ch == '(' : depth += 1
            if ch == ')' : depth -= 1
            if ch == ',' and depth == 0: parts.append(cur.strip()); cur = ''
            else: cur += ch
        parts.append(cur.strip())
        ins = [p for p in parts if not p.startswith('&')]
        outs = [re.sub(r'^&\(?|\)?$', '', p) for p in parts if p.startswith('&')]
        if not outs: return mo.group(0)
        return '[%s] = %s(%s);' % (', '.join(outs), name, ', '.join(ins))
    return re.sub(r'\b(BSIM4\w+|DEVpnjlim)\s*\(((?:[^;])*?)\)\s*;', rep, s, flags=re.S)
def dexp(s):
    s = re.sub(r'DEXP\(([^,]+),\s*(\w+),\s*(\w+)\)\s*;', r'[\2, \3] = DEXP3(\1);', s)
    return re.sub(r'DEXP\(([^,]+),\s*(\w+)\)\s*;', r'\2 = DEXP2(\1);', s)
def conv(s): return c2js(dexp(outcalls(st(s))), P)
setf, tempf, ldf, geof = D+'/bsim4/b4set.c', D+'/bsim4/b4temp.c', D+'/bsim4/b4ld.c', D+'/bsim4/b4geo.c'
a = find(setf, r'process defaults of model parameters'); b = find(setf, r'End processing models and begin to loop') - 2
mdef = conv(lines(setf, a+1, b))
a = find(setf, r'perform the parameter defaulting'); b = find(setf, r'process drain series resistance', a) - 1
idef = conv(lines(setf, a, b))
a = find(tempf, r'loop through all the BSIM4 device models') + 2; b = find(tempf, r'^\s*return\s*\(\s*OK\s*\)') - 1
tmp = conv(lines(tempf, a, b))
tmp = re.sub(r'for \(here = BSIM4instances\(model\);.*?BSIM4nextInstance\(here\)\)', '', tmp, flags=re.S)
tmp = tmp.rstrip().rstrip('}')
a = find(tempf, r'^double tmp, tmp1'); b = find(tempf, r'^int Size_Not_Found')
tdecl = conv(lines(tempf, a, b))
a = find(ldf, r'Source/drain junction diode DC model begins'); b = find(ldf, r'NQS begins', a) - 1
core = conv(lines(ldf, a, b))
a = find(ldf, r'if \(ChargeComputationNeeded\)', find(ldf, r'^finished:')); b = find(ldf, r'check convergence', a) - 2
jc = conv(lines(ldf, a, b))
a = find(ldf, r'if \(here->BSIM4rgateMod == 3\)', find(ldf, r'goto line850;', find(ldf, r'^finished:'))); b = find(ldf, r'here->BSIM4qgso = qgso;', a)
ov = conv(lines(ldf, a, b))
a = find(ldf, r'^double ceqgstot'); b = find(ldf, r'^int ByPass')
decl = conv(lines(ldf, a, b))
a = find(geof, r'^BSIM4NumFingerDiff') - 2
geo = open(geof).read().split('\n')[a-1:]
params = table(D+'/bsim4/b4.c', D+'/bsim4/b4mpar.c', P, 'BSIM4mPTable')
iparams = {}
src = open(D+'/bsim4/b4.c').read(); t = src[src.index('BSIM4pTable'):]; t = t[:t.index('};')]
ids = {}
for mo in re.finditer(r'IOPR?A?U?\s*\(\s*"(\w+)"\s*,\s*(\w+)\s*,', t): ids.setdefault(mo.group(2), []).append(mo.group(1).lower())
mp = open(D+'/bsim4/b4par.c').read()
for mo in re.finditer(r'case\s+(\w+)\s*:(.*?)break;', mp, flags=re.S):
    f = re.search(r'here->BSIM4(\w+)\s*=\s*value->(\w)Value', mo.group(2))
    if f and mo.group(1) in ids:
        for n in ids[mo.group(1)]: iparams[n] = f.group(1)

def cfuncs(text, only=None):
    out = []
    for mo in re.finditer(r'^(?:static\s+)?int\s*\n(\w+)\s*\(([^)]*)\)\s*\{', text, flags=re.M):
        name, params = mo.group(1), mo.group(2)
        if only and name not in only: continue
        # body: match braces
        i = mo.end(); depth = 1
        while depth:
            if text[i] == '{': depth += 1
            elif text[i] == '}': depth -= 1
            i += 1
        body = text[mo.end():i-1]
        ins, outs = [], []
        for p in params.split(','):
            p = p.strip(); pm = re.match(r'(?:double|int)\s*(\*?)\s*(\w+)', p)
            (outs if pm.group(1) else ins).append(pm.group(2))
        for o in outs: body = re.sub(r'\*\s*%s\b' % o, o, body)
        body = re.sub(r'NG_IGNORE\(\w+\);', '', body)
        body = re.sub(r'return\s*\(?\s*0\s*\)?\s*;', 'return [%s];' % ', '.join(outs), body)
        js = conv(body)
        out.append('  function %s(%s) {\n    let %s;\n%s\n    return [%s];\n  }' % (name, ', '.join(ins), ', '.join(o + ' = 0' for o in outs), js, ', '.join(outs)))
    return '\n'.join(out)
geoj = cfuncs(open(geof).read())
dioj = cfuncs(open(tempf).read(), ['BSIM4DioIjthVjmEval'])
pdj = cfuncs(open(ldf).read().replace('int BSIM4polyDepletion(\n', 'int\nBSIM4polyDepletion('), ['BSIM4polyDepletion'])
import sys as _s
d = json.loads(_s.stdin.read()) if False else None
P4 = ({'mdef': mdef, 'idef': idef, 'tmp': tmp, 'tdecl': tdecl, 'core': core, 'jc': jc, 'ov': ov, 'decl': decl, 'params': params, 'iparams': iparams, 'funcs': geoj + '\n' + dioj + '\n' + pdj})

d = P4
t = open(os.path.join(HERE, 'tpl4.js')).read()
tmp = d['tmp'].replace('BSIM4checkModel(model, here, ckt)', 'false').replace('m.pSizeDependParamKnot', 'm._knot')
decl = re.sub(r'^let m;$', '', d['decl'], flags=re.M)
for k, v in [('/*PARAMS*/', json.dumps(d['params'])), ('/*IPARAMS*/', json.dumps(d['iparams'])), ('/*FUNCS*/', d['funcs']), ('/*MDEF*/', d['mdef']), ('/*IDEF*/', d['idef']), ('/*TDECL*/', d['tdecl']), ('/*TMP*/', tmp), ('/*DECL*/', decl), ('/*CORE*/', d['core']), ('/*JC*/', d['jc']), ('/*OV*/', d['ov'])]:
    t = t.replace(k, v)
open(os.path.join(OUT, 'bsim4.js'), 'w').write(slim(t))
