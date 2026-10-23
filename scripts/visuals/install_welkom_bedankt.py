#!/usr/bin/env python3
"""Zet de nieuwe Welkom.show en Bedankt.show (uit make_welkom_bedankt.py --final) in een FreeShow-map en in de kopie in het
sjabloon (template.project), na een reservekopie van wat er nu staat.

Gebruik: install_welkom_bedankt.py --fs <FreeShow-map> --template <template.project> --shows <map met Welkom.show en Bedankt.show> [--uitvoeren]
Zonder --uitvoeren gebeurt er niets: het script laat alleen zien wat het zou vervangen (droog).
Met --uitvoeren: eerst een reservekopie in <FreeShow-map>/_backup-welkom-bedankt-<datum>[-n] (Welkom.show, Bedankt.show, template.project),
dan vervangen via tijdelijk bestand + hernoemen. De show-id's blijven gelijk, want sjabloon en projecten verwijzen daarnaar.
"""
import argparse, json, os, shutil, sys, time, zipfile

NAMEN = ("Welkom", "Bedankt")


def lees_show(pad):
    sid, c = json.load(open(pad, encoding='utf-8'))
    lay = list(c['layouts'].values())[0]['slides']
    dias = []
    for x in lay:
        s = c['slides'][x['id']]
        tekst = [r['value'] for i in s['items'] if i['type'] == 'text' for l in i['lines'] for r in l['text'] if r['value']]
        media = [os.path.basename(i['src']) for i in s['items'] if i['type'] == 'media']
        dias.append((s['group'], tekst, media, c['media'].get(x.get('background', ''), {}).get('name')))
    return sid, c, dias


def beschrijf(label, dias):
    print(f'  {label}: {len(dias)} dia\'s')
    for groep, tekst, media, bg in dias:
        print(f'    - {groep}: tekst={tekst} media={media} achtergrond={bg}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fs', required=True); ap.add_argument('--template', required=True); ap.add_argument('--shows', required=True)
    ap.add_argument('--uitvoeren', action='store_true')
    a = ap.parse_args()
    nieuw = {}
    for n in NAMEN:
        sid, c, dias = lees_show(os.path.join(a.shows, f'{n}.show'))
        huidig_pad = os.path.join(a.fs, 'Shows', f'{n}.show')
        osid, oc, odias = lees_show(huidig_pad)
        print(f'== {n}: id nu {osid}, nieuw {sid}' + ('  (GELIJK)' if osid == sid else '  (VERSCHILT: stop)'))
        if osid != sid:
            sys.exit('Show-id verschilt; sjabloon en projecten verwijzen naar het id. Niets gedaan.')
        beschrijf('nu', odias); beschrijf('straks', dias)
        nieuw[sid] = (n, c)
    zin = zipfile.ZipFile(a.template); data = json.loads(zin.read('data.json'))
    for sid, (n, c) in nieuw.items():
        assert sid in data['shows'], f'{n} ({sid}) staat niet in het sjabloon'
        print(f'sjabloon: kopie van {n} wordt vervangen ({len(data["shows"][sid]["slides"])} -> {len(c["slides"])} dia\'s)')
    if not a.uitvoeren:
        print('\nDROOG: er is niets gewijzigd. Voeg --uitvoeren toe om te vervangen.'); return
    basis = os.path.join(a.fs, '_backup-welkom-bedankt-' + time.strftime('%Y%m%d')); bk = basis; i = 1
    while os.path.exists(bk): i += 1; bk = f'{basis}-{i}'
    os.makedirs(bk)
    for n in NAMEN: shutil.copy2(os.path.join(a.fs, 'Shows', f'{n}.show'), os.path.join(bk, f'{n}.show'))
    shutil.copy2(a.template, os.path.join(bk, 'template.project'))
    print('reservekopie:', bk)
    for sid, (n, c) in nieuw.items():
        doel = os.path.join(a.fs, 'Shows', f'{n}.show'); tmp = os.path.join(a.fs, 'Shows', f'.ark-tmp-{n}')
        json.dump([sid, c], open(tmp, 'w', encoding='utf-8'), ensure_ascii=False); os.chmod(tmp, 0o666); os.replace(tmp, doel)
        data['shows'][sid] = c
    tmpz = a.template + '.tmp'
    with zipfile.ZipFile(tmpz, 'w', zipfile.ZIP_DEFLATED) as zo:
        for it in zin.infolist():
            zo.writestr(it, json.dumps(data, ensure_ascii=False) if it.filename == 'data.json' else zin.read(it.filename))
    zin.close(); os.replace(tmpz, a.template)
    for n in NAMEN:
        s = json.load(open(os.path.join(a.fs, 'Shows', f'{n}.show'), encoding='utf-8'))[1]
        print(f'klaar: {n}.show heeft nu {len(s["slides"])} dia\'s')
    print('klaar: sjabloon bijgewerkt')


if __name__ == '__main__':
    main()
