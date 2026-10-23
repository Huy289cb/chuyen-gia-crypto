import {it,expect} from 'vitest';
import {withProviderPurpose as withPurpose,currentProviderPurpose as current} from '../../src/utils/provider-purpose-context';
import {captureProviderRequestContext as capture} from '../../src/utils/provider-request-context';
it('keeps absent purpose null and restores parent after nested call',()=>{expect(current()).toBeNull();withPurpose('dispatch',()=>{expect(current()).toBe('dispatch');withPurpose('shadow',()=>expect(capture().provider_purpose).toBe('shadow'));expect(current()).toBe('dispatch');});expect(current()).toBeNull();});
it('preserves original exception and restores context',()=>{const error=new Error('failure');expect(()=>withPurpose('pending_review',()=>{throw error;})).toThrow(error);expect(current()).toBeNull();});
it('isolates concurrent async purposes without inventing caller trace',async()=>{const rows=await Promise.all(['shadow','pending_review'].map(p=>withPurpose(p as any,async()=>{await Promise.resolve();return capture();})));expect(rows.map(r=>r.provider_purpose)).toEqual(['shadow','pending_review']);expect(rows.every(r=>r.trace_id===null)).toBe(true);});
