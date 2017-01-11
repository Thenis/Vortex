import {IExtensionApi} from '../../../types/IExtensionContext';

import { IMod } from '../types/IMod';

import { ILookupResult, IReference, IRule, RuleType } from 'modmeta-db';

import { log } from '../../../util/log';

import * as Promise from 'bluebird';
import {Graph, alg} from 'graphlib';
import * as semver from 'semvish';

interface IBiRule {
  subject: string;
  object: string;
  type: RuleType;
}

function testRef(mod: IMod, ref: IReference): boolean {
  const attr: any = mod.attributes;
  // if reference is by file hash, use only that
  if (ref.fileMD5 !== undefined) {
    return attr.fileMD5 === ref.fileMD5;
  }

  // right mod?
  if (attr.modId !== ref.modId) {
    return false;
  }

  // right file?
  if (((ref.logicalFileName !== undefined) &&
       (ref.logicalFileName !== attr.logicalFileName)) ||
      (!new RegExp(ref.fileExpression).test(mod.installationPath))) {
    return false;
  }

  // right version?
  return semver.satisfies(attr.version, ref.versionMatch);
}

function findByRef(mods: IMod[], reference: IReference): IMod {
  return mods.find((mod: IMod) => testRef(mod, reference));
}

function sortMods(mods: IMod[], api: IExtensionApi): Promise<string[]> {
  let dependencies = new Graph();

  const modMapper = (mod: IMod) => {
    const attributes = mod.attributes as any;
    return api.lookupModMeta({
                fileMD5: attributes.fileMD5,
                fileSize: attributes.size,
                modId: attributes.modId,
              })
        .then((metaInfo: ILookupResult[]) => {
          if ((metaInfo.length !== 0) &&
              (metaInfo[0].value.rules !== undefined)) {
            metaInfo[0].value.rules.forEach((rule: IRule) => {
              const ref = findByRef(mods, rule.reference);
              if (ref !== undefined) {
                if (rule.type === 'before') {
                  dependencies.setEdge(mod.id, ref.id);
                } else if (rule.type === 'after') {
                  dependencies.setEdge(ref.id, mod.id);
                }
              }
            });
          }
          return Promise.resolve();
        });
  };

  mods.forEach((mod: IMod) => { dependencies.setNode(mod.id); });

  return Promise.map(mods, modMapper)
      .catch((err: Error) => {
        log('error', 'failed to sort mods',
            {msg: err.message, stack: err.stack});
      })
      .then(() => { return Promise.resolve(alg.topsort(dependencies)); });
}

export default sortMods;
