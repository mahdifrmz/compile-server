import { promises, createWriteStream } from 'fs'
import db from './db.js'
import storage from './storage.js'
const fs = promises

const root = process.argv[2]
const minioFilesBucket = 'projsrc'

function projectDir(pid) {
    return `${root}/projects/${pid}`
}

async function fsExists(path) {
    try {
        await fs.access(path);
        return true;
    }
    catch (err) {
        return false;
    }
}

async function makeProjectDir(pid) {
    const projdir = projectDir(pid);
    await fs.mkdir(`${projdir}/objects/`, { recursive: true });
    await fs.mkdir(`${projdir}/targets/`, { recursive: true });
}

async function makeTree(tree, path, map) {
    if (!isNaN(tree)) {
        map[String(tree)] = { path, version: 0 }
    }
    else {
        await fs.mkdir(path);
        for (const ch in tree)
            await makeTree(tree[ch], `${path}/${ch}`, map);
    }
}

async function makeSrcDir(pid, tree) {
    const srcDir = `${projectDir(pid)}/src`;
    if (await fsExists(srcDir)) {
        await fs.rm(srcDir, { recursive: true, force: true });
    }
    let map = {};
    await makeTree(tree, srcDir, map)
    return map
}

async function getVersionList(pid, config, version) {
    const versionFile = `${projectDir(pid)}/version.json`;
    let versionList;
    if (!await fsExists(versionFile)) {
        versionList = { config: 0, files: {} };
    }
    else {
        versionList = JSON.parse(await fs.readFile(versionFile));
    }
    if (versionList.config < version) {
        versionList.files = await makeSrcDir(pid, config.tree);
        versionList.config = version
    }
    return versionList;
}

async function updateFile(objkey, path) {
    console.log(objkey, '->', path);
    return new Promise(async (res, rej) => {
        try {
            let strm = await storage.getObject(minioFilesBucket, objkey);
            strm.pipe(createWriteStream(path));
            res();
        }
        catch (err) {
            rej(err)
        }
    })
}

async function updateSrcTree(pid, versionList) {
    let updateList = []

    const dbfiles = await db.getFiles(pid);
    for (const fid in versionList.files) {
        let file = versionList.files[fid];
        const dbentry = dbfiles.find(f => { return f.id == Number(fid) });
        if (!dbentry)
            return false;
        if (dbentry.version > file.version) {
            updateList.push(updateFile(dbentry.key, file.path));
            file.version = dbentry.version;
        }
    }
    await fs.writeFile(`${projectDir(pid)}/version.json`, JSON.stringify(versionList));
    try {
        await Promise.all(updateList);
        return true;
    }
    catch (err) {
        return false;
    }
}

async function build(bid) {
    const { id: pid, config, version } = await db.getProject(bid);
    await makeProjectDir(pid);
    const versionList = await getVersionList(pid, config, version);
    await updateSrcTree(pid, versionList);

    // create project dependency graph
    // compile every source file and store log
    // link every target after all of it's dependencies are linked
    // upload target files
    // upload log file
    // update build entry
    // notify server
}

export default build;