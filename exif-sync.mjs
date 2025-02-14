import exiftool from 'node-exiftool';
import exiftoolBin from 'dist-exiftool';
import { ArgumentParser } from 'argparse';
import { readdir } from 'node:fs/promises';
import Path from 'node:path';
import _ from 'lodash';

const parser = new ArgumentParser({
  description: 'Copy over exif metadata'
});
   
parser.add_argument('-t', '--target', { help: 'Path to target directory', required: true });
parser.add_argument('-s', '--source', { help: 'Path to source directory', required: true });
parser.add_argument('-c', '--commit', { help: 'Apply changes (default is preview)', required: false, action: 'store_true'})
parser.add_argument('-v', '--verbose', { help: 'Show EXIF details', required: false, action: 'store_true'})


const { target, source, commit, verbose } = parser.parse_args();

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
  const attrsInScope = [
    'MediaCreateDate',
    'MediaModifyDate',
    'TrackCreateDate',
    'TrackModifyDate',
    'CreateDate',
    'ModifyDate',
    'EncodingTime'
  ]
  const { data: [sourceMetadata] } = await ep.readMetadata(sourceFileName, ['-File:all']);
  const newTimestamp = _.sortBy(Object.values(_.pick(sourceMetadata, attrsInScope)))[0];

  const { data: [targetMetadata] } = await ep.readMetadata(targetFileName, ['-File:all']);
  const targetMetadataBefore = _.pick(targetMetadata, attrsInScope);
  const targetMetadataAfter = Object.fromEntries(
    Object.keys(targetMetadataBefore).map(k => [k, sourceMetadata[k] ?? newTimestamp])
  )

  if(verbose){
    console.log('Replacing', targetMetadataBefore, 'with', targetMetadataAfter);
  }
  if(commit) {
    await ep.writeMetadata(targetFileName, targetMetadataAfter, ['overwrite_original']);
  }
}

await ep.close();
console.log(`${singleFileMatches.length} exact matches, ${multipleFileMatches.length} multiple matches, ${noFileMatches.length} match failures`);
