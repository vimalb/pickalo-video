import exiftool from 'node-exiftool';
import exiftoolBin from 'dist-exiftool';
import { ArgumentParser } from 'argparse';
import { readdir } from 'node:fs/promises';
import Path from 'node:path';
import _ from 'lodash';
import * as dateFns from 'date-fns';

const parser = new ArgumentParser({
  description: 'Copy over exif metadata'
});
   
parser.add_argument('-t', '--target', { help: 'Path to target directory', required: true });
parser.add_argument('-s', '--source', { help: 'Path to source directory', required: true });
parser.add_argument('-c', '--commit', { help: 'Apply changes (default is preview)', required: false, action: 'store_true'})
parser.add_argument('-v', '--verbose', { help: 'Show EXIF details', required: false, action: 'store_true'})
parser.add_argument('-tz', '--timezone', { help: 'Override timezone offset (eg: -05:00)'});

const { target, source, commit, verbose, timezone} = parser.parse_args();

const targetFiles = await readdir(target);
const sourceFiles = await readdir(source);

const sourceFileTuples = _.sortBy(
  sourceFiles.map(fname => [Path.parse(fname).name, fname]),
  (tup) => tup[0].length
);
sourceFileTuples.reverse();

const fileMatches = targetFiles.map((fname) => {
  const matchingTuples = sourceFileTuples.filter(([prefix, filename]) => fname.startsWith(prefix));
  return {
    targetFileName: Path.join(target, fname),
    sourceFileName: matchingTuples.length > 0 ? Path.join(source, matchingTuples[0][1]) : null,
    matchCount: matchingTuples.length
  }
});

const multipleFileMatches = fileMatches.filter(m => m.matchCount > 1);
const singleFileMatches = fileMatches.filter(m => m.matchCount === 1);
const noFileMatches = fileMatches.filter(m => m.matchCount === 0);

multipleFileMatches.forEach(m => console.log(`Found ${m.matchCount} source matches for ${m.targetFileName}`));
noFileMatches.forEach(m => console.log(`Could not find source matches for ${m.targetFileName}`));


const matchesToUpdate = [...multipleFileMatches, ...singleFileMatches];

const ep = new exiftool.ExiftoolProcess(exiftoolBin)
await ep.open();

for(let i=0; i<matchesToUpdate.length; i++) {
  const {sourceFileName, targetFileName } = matchesToUpdate[i];
  console.log(`Copy metadata from ${sourceFileName} to ${targetFileName}`);
  const timestampAttrsInScope = [
    'MediaCreateDate',
    'MediaModifyDate',
    'TrackCreateDate',
    'TrackModifyDate',
    'CreateDate',
    'ModifyDate',
    'EncodingTime'
  ]
  const { data: [sourceMetadata] } = await ep.readMetadata(sourceFileName, ['-File:all']);
  const newTimestamp = _.sortBy(Object.values(_.pick(sourceMetadata, timestampAttrsInScope)))[0];

  const { data: [targetMetadata] } = await ep.readMetadata(targetFileName, ['-File:all']);
  const targetMetadataBefore = _.pick(targetMetadata, timestampAttrsInScope);
  const formatTimestamp = (ts) => {
    return timezone ? dateFns.parse(
      `${ts} ${timezone}`, 'yyyy:MM:dd HH:mm:ss XXXXX', new Date()
    ).toISOString().substring(0,19).replaceAll('T', ' ').replaceAll('-',':') : ts;
  };
  const targetMetadataAfter = Object.fromEntries(
    Object.keys(targetMetadataBefore).map(k => [k, formatTimestamp(sourceMetadata[k] ?? newTimestamp)])
  )

  if(verbose){
    console.log('Replacing', targetMetadataBefore, 'with', targetMetadataAfter);
    const allKeys = Object.keys({
      ...sourceMetadata,
      ...targetMetadata
    })
    const allDiffs = allKeys.map(k => [k, [sourceMetadata[k] ?? null, targetMetadata[k] ?? null]])
    //console.log(allDiffs)
  }
  if(commit) {
    await ep.writeMetadata(targetFileName, targetMetadataAfter, ['overwrite_original']);

  }
}

await ep.close();
console.log(`${singleFileMatches.length} exact matches, ${multipleFileMatches.length} multiple matches, ${noFileMatches.length} match failures`);
