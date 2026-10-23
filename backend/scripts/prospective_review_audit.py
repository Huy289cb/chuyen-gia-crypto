"""Link quota reservations to result records without netting away missing responses."""
import math
import re


def known_cost(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def review_links(claim_files, result_files):
    claims, invalid_claims, invalid_results = {}, [], []
    for name, data in claim_files.items():
        m = re.fullmatch(r'quota-(-?\d+)-(\d+)\.json', name)
        try:
            hour, time = data['hour'], data['time']
            if not m or any(not isinstance(x,int) or isinstance(x,bool) for x in (hour,time)):
                raise ValueError()
            day, slot = map(int,m.groups())
            if slot < 1 or time//3600000 != hour or (time+25200000)//86400000 != day:
                raise ValueError()
            claims[(day,slot,hour)] = name
        except (TypeError,KeyError,ValueError): invalid_claims.append(name)
    linked = {key:[] for key in claims}
    for name, data in result_files.items():
        try:
            c=data['claim']; key=(c['day'],c['slot'],c['hour'])
            if any(not isinstance(x,int) or isinstance(x,bool) for x in key) or key not in claims:
                raise ValueError()
            linked[key].append(name)
        except (TypeError,KeyError,ValueError): invalid_results.append(name)
    missing=[claims[k] for k,v in linked.items() if not v]
    duplicates=[claims[k] for k,v in linked.items() if len(v)>1]
    return {'claimsWithoutResult':len(missing),'missingResultClaims':sorted(missing),
            'orphanOrInvalidResults':sorted(invalid_results),'invalidClaims':sorted(invalid_claims),
            'duplicateResultClaims':sorted(duplicates),
            'reviewJournalComplete':not (missing or invalid_results or invalid_claims or duplicates)}
