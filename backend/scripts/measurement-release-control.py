#!/usr/bin/env python3
"""Verify/rehearse/apply/rollback a sealed measurement package. Never starts/stops PM2.

apply/rollback require a stopped target and exact checksums. They change code only;
operator must separately verify flat exchange state and owner risk policy.
"""
import argparse, fcntl, hashlib, json, os, pathlib, shutil, tempfile, uuid

def inventory(root):
    if not root.is_dir() or root.is_symlink(): raise ValueError('Expected a real directory')
    result={}
    for p in sorted(root.rglob('*')):
        if p.is_symlink(): raise ValueError('Symlinks are not accepted in release trees')
        if p.is_file(): result[str(p.relative_to(root))]=hashlib.sha256(p.read_bytes()).hexdigest()
    return result

def verify(package):
    manifest=json.loads((package/'manifest.json').read_text())
    for variant in ('baseline','release'):
        if inventory(package/variant)!=manifest[variant]: raise ValueError(variant+' checksum mismatch')
    return manifest

def active_processes(target):
    # All commands whose entrypoint or cwd references this tree must be stopped.
    hits=[]
    prefix=str(target.resolve())+'/'
    for p in pathlib.Path('/proc').iterdir():
        if not p.name.isdigit() or int(p.name)==os.getpid(): continue
        try:
            args=(p/'cmdline').read_bytes().split(b'\0')
            command=[x.decode(errors='replace') for x in args if x]
            entry=any(x.startswith(prefix) for x in command)
            try: cwd=(p/'cwd').resolve(strict=True); inside=cwd==target or target in cwd.parents
            except OSError: inside=False
            # Ignore this tool's parent shell whose argument text mentions a path;
            # absolute argv entries and cwd checks still catch node server/worker.
            if entry or inside: hits.append({'pid':int(p.name),'entrypoint':command[:2]})
        except (FileNotFoundError,ProcessLookupError): pass
        except PermissionError:
            if p.stat().st_uid==os.getuid(): raise ValueError('Cannot inspect own process '+p.name)
    return hits

def switch(package,target,direction):
    manifest=verify(package)
    if target.is_symlink(): raise ValueError('Refusing symlink target')
    target=target.absolute()
    if package==target or package in target.parents or target in package.parents:
        raise ValueError('Target must be outside the sealed package')
    expected='baseline' if direction=='apply' else 'release'
    desired='release' if direction=='apply' else 'baseline'
    with (target.parent/'.measurement-release.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if active_processes(target): raise ValueError('Target processes still running; code was not changed')
        if target.exists() and inventory(target)!=manifest[expected]: raise ValueError('Target changed; refusing replacement')
        if not target.exists() and direction!='rollback': raise ValueError('Missing target; use rollback for interrupted switch')
        staged=target.with_name(target.name+'.measurement-stage-'+uuid.uuid4().hex)
        retired=target.with_name(target.name+'.measurement-backup-'+uuid.uuid4().hex)
        shutil.copytree(package/desired,staged)
        try:
            if inventory(staged)!=manifest[desired]: raise ValueError('Staged copy mismatch')
            if active_processes(target): raise ValueError('Target restarted during preparation')
            if target.exists():
                if inventory(target)!=manifest[expected]: raise ValueError('Target mutated during preparation')
                target.rename(retired)
            try: staged.rename(target)
            except BaseException:
                if retired.exists() and not target.exists(): retired.rename(target)
                raise
        finally:
            if staged.exists(): shutil.rmtree(staged)
        if inventory(target)!=manifest[desired]: raise ValueError('Post-switch verification failed; processes must remain stopped')
        return {'direction':direction,'target':str(target),'matches':desired,
                'retainedBackup':str(retired) if retired.exists() else None,'processesStarted':False}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('command',choices=['verify','preflight','rehearse','apply','rollback'])
    ap.add_argument('--package',type=pathlib.Path,required=True);ap.add_argument('--target',type=pathlib.Path)
    a=ap.parse_args();package=a.package.resolve();m=verify(package)
    if a.command=='verify': result={'verified':True,'changedFiles':len(m['changedFiles'])}
    elif a.command=='rehearse':
        with tempfile.TemporaryDirectory(prefix='measurement-rehearsal-') as directory:
            target=pathlib.Path(directory)/'dist';shutil.copytree(package/'baseline',target)
            applied=switch(package,target,'apply');rolled=switch(package,target,'rollback')
            assert inventory(target)==m['baseline']
            result={'rehearsalPassed':True,'applyVerified':applied['matches']=='release',
                    'rollbackVerified':rolled['matches']=='baseline','liveTargetTouched':False}
    else:
        if not a.target: raise ValueError('--target required')
        if a.command=='preflight':
            target=a.target.absolute();actual=inventory(target);running=active_processes(target)
            result={'targetMatchesBaseline':actual==m['baseline'],'targetMatchesRelease':actual==m['release'],
                    'activeProcesses':running,'stopped':not running,'mutationPerformed':False}
        else: result=switch(package,a.target,a.command)
    print(json.dumps(result,indent=2))

if __name__=='__main__': main()
