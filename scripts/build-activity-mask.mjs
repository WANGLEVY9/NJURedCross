/** Preserve every alpha pixel; discard RGB data unused by a CSS alpha mask. */
import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('../public/assets/activity-icons/centres.png',import.meta.url));
const target=fileURLToPath(new URL('../public/assets/activity-icons/centres-mask.png',import.meta.url));
const {width,height}=await sharp(source).metadata();
const alpha=await sharp(source).extractChannel('alpha').png().toBuffer();
await sharp({create:{width,height,channels:3,background:'#ffffff'}})
 .joinChannel(alpha).png({compressionLevel:9}).toFile(target);
const original=await sharp(source).extractChannel('alpha').raw().toBuffer();
const result=await sharp(target).extractChannel('alpha').raw().toBuffer();
if(!original.equals(result))throw new Error('Activity mask alpha must remain identical');
