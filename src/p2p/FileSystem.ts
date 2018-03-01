import IPFS from 'ipfs';
import OrbitDB from 'orbit-db';
import IPFSDir from '../models/Dir';
import IPFSFile from '../models/File';
import { Event } from '../lib/Event';
const uuidv1 = require('uuid/v1');

export default class FileSystem extends Event {

    private orbit: OrbitDB;
    private db: OrbitDB.Store;
    private ipfs: IPFS;
    readonly address: string

    constructor(ipfs: IPFS, dbAddress?: string) {
        super();
        this.ipfs = ipfs;
        this.address = dbAddress ? `${dbAddress}/disk` : 'disk';
        this.orbit = new OrbitDB(ipfs);
    }

    async load() {
        this.db = await this.orbit.docs(this.address, { indexBy: 'id', });
        await this.db.load();

        console.log(this.db.address, this.db.address.toString());
        this.db.events.on('replicated', (address) => this.trigger('replicated', address));
        this.db.events.on('replicate', (address) => this.trigger('replicate', address));

        if (!this.getDir('root')) {
            await this.mkdir('root', '', 'root')
        }
    }

    onReplicated(callback: (sender: FileSystem, address: string) => void) {
        super.register('replicated', callback);
    }

    onReplicate(callback: (sender: FileSystem, address: string) => void) {
        super.register('replicate', callback);
    }

    async mkdir(title: string, parentId = 'root', id = uuidv1()) {
        let dir: IPFSDir = {
            id,
            title,
            files: [],
            dirs: [],
            parentId,
            type: 'dir',
        };

        let parent = this.getDir(parentId);

        if (!parent) {
            dir = await this.updateDir(dir);
            console.log('create no parent dir', dir);
            return null
        };

        parent.dirs.unshift(dir);
        await this.updateDir(parent);

        return dir;
    }

    async rmdir(id: string) {
        return await this.db.del(id) ? true : false;
    }

    getDir(id: string): IPFSDir {
        let items = this.db.get(id);
        return items && items instanceof Array ? items[0] : null;
    }

    async updateDir(dir: IPFSDir) {
        console.log('update dir', dir);
        let hash = await this.db.put(dir);
        return hash ? dir : null;
    }

    listAllItems() {
        return this.db.query(item => item) as (IPFSDir | IPFSFile)[];
    }

    getRootDir() {
        let root = (this.db.get('root') as IPFSDir[])[0];
        console.log('root', root);
        return root;
    }

    async addFile(file: File, dirId: string, onProgress?: (offset: number, total: number) => void) {
        return new Promise<IPFSFile[]>((resolve, reject) => {
            let reader = new FileReader();
            reader.readAsArrayBuffer(file);
            reader.onerror = (ev) => reject();
            reader.onabort = (ev) => reject();
            reader.onloadend = (ev) => {
                this.ipfs.files.add(
                    { path: file.name, content: Buffer.from(reader.result) },
                    { progress(offset) { onProgress(offset, file.size) } },
                    async (err, res: { path: string, hash: string, size: number }[]) => {

                        if (err) {
                            reject(err);
                            return;
                        }

                        let dirs = this.db.query(item => item.id === dirId) as IPFSDir[];
                        let dir = dirs.pop();
                        if (!dir) return;

                        let savedFiles = res.map<IPFSFile>(r => { return { id: r.hash, type: 'file', title: file.name, mime: file.type, dirId, timestamp: Date.now(), size: r.size, } });
                        dir.files = dir.files.concat(savedFiles);
                        this.updateDir(dir);

                        resolve(savedFiles);
                    });
            };
        });
    }

    rmFile(id: string) {

    }
}