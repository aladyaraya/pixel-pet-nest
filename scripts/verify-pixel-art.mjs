/** Browser asset contract check and reproducible contact sheets.
 * Usage: node scripts/verify-pixel-art.mjs [http://127.0.0.1:5179/]
 * Requires an already-running Vite server. Never starts/restarts it or writes source files.
 * Outputs .acceptance-pixel/*.png and art-resource-report.json by default.
 * PIXEL_ART_OUT overrides the output directory (relative to repository root, or absolute).
 * Visual recognition still needs human review.
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve, sep } from 'node:path'

const address = process.argv[2] ?? 'http://127.0.0.1:5179/'
const repository = fileURLToPath(new URL('../', import.meta.url))
const out = pathToFileURL(resolve(repository, process.env.PIXEL_ART_OUT || '.acceptance-pixel') + sep)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(address, { waitUntil: 'networkidle' })
  const report = await page.evaluate(async () => {
    const { petVisuals, pixelEggImage, PIXEL_PAINT } = await import('/src/shared/egg/pixelVisuals.ts')
    const { PETS, petFrame } = await import('/src/shared/egg/pets.ts')
    const { petIdleVariants, petReactionFrames } = await import('/src/shared/egg/petMotionFrames.ts')
    const React = await import('/node_modules/.vite/deps/react.js')
    const DOM = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { PixelPetSprite, PixelEggSprite, PixelNest } = await import('/src/app/components/PixelSprites.tsx')
    const h = React.createElement ?? React.default.createElement
    const createRoot = DOM.createRoot ?? DOM.default.createRoot
    const failures = []
    const check = (condition, label) => { if (!condition) failures.push(label) }
    const key = (image) => image.rows.join('')
    function inspect(image, label, size) {
      check(image.size === size && image.rows.length === size && image.rows.every(row => row.length === size), `${label}: dimensions`)
      const positions = []
      image.rows.forEach((row, y) => [...row].forEach((ink, x) => {
        check(ink === '.' || ink in PIXEL_PAINT, `${label}: paint (${x},${y})`)
        if (ink !== '.') positions.push([x, y])
      }))
      check(positions.length > 0, `${label}: empty`)
      check(positions.every(([x,y]) => x > 0 && y > 0 && x < size - 1 && y < size - 1), `${label}: safety margin`)
      check(image.paths.every(path => /^[Mhvz\d\s-]+$/.test(path.d)), `${label}: non-orthogonal path`)
      return { x0:Math.min(...positions.map(p=>p[0])),y0:Math.min(...positions.map(p=>p[1])),x1:Math.max(...positions.map(p=>p[0])),y1:Math.max(...positions.map(p=>p[1])) }
    }
    function inspectBack(sequence, id, label) {
      const valid = sequence.length === 3 && sequence.every(frame => frame.length === 391 && frame.every(v => v === 0 || v === 255)
        && frame.every((v, i) => (i < 17 || i >= 374 || i % 17 === 0 || i % 17 === 16) ? v === 0 : true))
      const unique = new Set(sequence.map(frame => frame.join(','))).size
      const lastIsBase = sequence.at(-1).join(',') === petFrame(id).join(',')
      check(valid && unique === 3 && lastIsBase, `${id}/${label}: rear sequence`)
      return { frames: sequence.length, unique, allValid: valid, lastIsBase }
    }
    check(PETS.length === 12 && Object.keys(petVisuals).length === 12, '12 visual identities')
    const pets = PETS.map(pet => {
      const visual = petVisuals[pet.id]
      check(!!visual, `${pet.id}: missing visual`)
      const main = inspect(visual.main, `${pet.id}/main`, 64)
      const thumbnail = inspect(visual.thumbnail, `${pet.id}/thumbnail`, 32)
      const motions = Object.fromEntries(['idle-a','idle-b','tap','hold'].map(kind => {
        const images = visual.motions[kind]
        const expected = kind === 'tap' ? 5 : kind === 'hold' ? 6 : 4
        const unique = new Set(images.map(key)).size
        const lastIsBase = key(images.at(-1)) === key(visual.main)
        check(images.length === expected && unique > 1 && lastIsBase, `${pet.id}/${kind}: front sequence`)
        return [kind, {count:images.length, unique, lastIsBase, bounds:images.map((image, index) => inspect(image,`${pet.id}/${kind}/${index}`,64))}]
      }))
      const idle = petIdleVariants(pet.id)
      check(idle.length === 2, `${pet.id}: two rear idle variants`)
      const back = [...idle,petReactionFrames(pet.id,'tap'),petReactionFrames(pet.id,'hold')].map((frames,index)=>inspectBack(frames,pet.id,['idle-a','idle-b','tap','hold'][index]))
      return { id:pet.id,main,thumbnail,paths:visual.main.paths.length,motions,back }
    })

    const phases = ['waiting','cracking','almost','ready','revealed']
    let eggFramesChecked = 0
    for (const phase of phases) {
      inspect(pixelEggImage(phase,null,0),`egg/${phase}/base`,64);eggFramesChecked++
      for (const motion of ['idle-a','idle-b','tap','hold']) {
        const length = motion === 'tap' ? 5 : motion === 'hold' ? 6 : 4
        for(let frame=0;frame<length;frame++) { inspect(pixelEggImage(phase,motion,frame),`egg/${phase}/${motion}/${frame}`,64);eggFramesChecked++ }
      }
    }
    const opened = [0,1,2,3].map(frame=>pixelEggImage('ready',null,frame,true))
    opened.forEach((image,index)=>inspect(image,`egg/breaking/${index}`,64))
    const whole = pixelEggImage('waiting',null,0)
    const eggBounds = inspect(whole,'egg/standard-shape',64)
    check(eggBounds.x1-eggBounds.x0+1===32 && eggBounds.y1-eggBounds.y0+1===44,'standard egg is 32×44')
    // Contract rather than reimplementing the seam: closed silhouette survives frame 0,
    // and for each column there exists ONE split that explains all three movements
    // by translating its original upper pixels while leaving every lower pixel fixed.
    let sameClosedMask = true, exactSplitPreservesPaint = true
    for (let x=16;x<48;x++) {
      for (let y=0;y<64;y++) if ((whole.rows[y][x]!=='.') !== (opened[0].rows[y][x]!=='.')) sameClosedMask=false
      let found = false
      for(let split=1;split<63 && !found;split++) {
        found = [1,2,3].every(frame => {
          const expected=Array(64).fill('.')
          for(let y=0;y<64;y++) if(opened[0].rows[y][x]!=='.') {
            const destination=y-(y<split?frame*3:0)
            if(destination<0) return false
            expected[destination]=opened[0].rows[y][x]
          }
          return expected.every((ink,y)=>opened[frame].rows[y][x]===ink)
        })
      }
      if(!found) exactSplitPreservesPaint=false
    }
    check(sameClosedMask,'egg split changes original silhouette')
    check(exactSplitPreservesPaint,'egg split changes paint or lower-shell position')

    const app = document.getElementById('root'); if(app) app.style.display='none'
    const host=document.createElement('div');host.id='art-inspect';document.body.appendChild(host)
    const style=document.createElement('style')
    style.textContent=`body{overflow:auto!important;background:rgb(var(--background))}#art-inspect{padding:24px;color:rgb(var(--foreground));font-family:sans-serif}.qa-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.qa-cell{background:rgb(var(--surface));border:2px solid rgb(var(--border));padding:12px;min-width:0}.qa-name{font-size:16px;font-weight:600;margin-bottom:8px}.qa-pictures{display:flex;align-items:end;justify-content:space-between;gap:8px}.qa-main{width:192px;height:192px}.qa-thumb{width:96px;height:96px}.qa-matrix{width:68px;height:92px;background:rgb(var(--foreground));padding:2px;margin-top:8px}.qa-matrix rect{fill:rgb(var(--art-gold))}.qa-sub{display:flex;gap:8px;align-items:end}.qa-label{font-size:12px;margin-top:6px}.qa-egg{position:relative;width:256px;height:256px}.qa-egg>svg{position:absolute;width:256px;height:256px;inset:0}.qa-main>svg,.qa-thumb>svg{width:100%;height:100%}.qa-back-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}.paint-silhouette{fill:rgb(var(--art-silhouette))}`
    document.head.appendChild(style)
    const root=createRoot(host)
    const matrix=frame=>h('svg',{className:'qa-matrix',viewBox:'0 0 17 23',shapeRendering:'crispEdges'},frame.flatMap((value,index)=>value?[h('rect',{key:index,x:index%17,y:Math.floor(index/17),width:1,height:1})]:[]))
    window.drawPetSheet=(motion=null,frame=0)=>root.render(h('div',{className:'qa-grid'},PETS.map(pet=>h('section',{className:'qa-cell',key:pet.id},h('div',{className:'qa-name'},pet.name),h('div',{className:'qa-pictures'},h('div',{className:'qa-main'},h(PixelPetSprite,{petId:pet.id,motion,frame})),h('div',{className:'qa-thumb'},h(PixelPetSprite,{petId:pet.id,motion:null,frame:0,thumbnail:true}))),h('div',{className:'qa-sub'},matrix(motion==='tap'||motion==='hold'?petReactionFrames(pet.id,motion)[Math.min(frame,1)]:petFrame(pet.id)),h('div',{className:'qa-label'},'64×64 / 32×32 / 17×23'))))))
    window.drawEggSheet=()=>root.render(h('div',{className:'qa-grid'},['waiting','cracking','almost','ready'].map(phase=>h('section',{className:'qa-cell',key:phase},h('div',{className:'qa-name'},phase),h('div',{className:'qa-egg'},h(PixelNest,{}),h(PixelEggSprite,{phase,motion:null,frame:0})))),[0,1,2,3].map(frame=>h('section',{className:'qa-cell',key:frame},h('div',{className:'qa-name'},'breaking '+frame),h('div',{className:'qa-egg'},h(PixelNest,{}),h(PixelEggSprite,{phase:'ready',motion:null,frame,breaking:true}))))))
    window.drawRearSheet=()=>root.render(h('div',{},PETS.map(pet=>h('section',{key:pet.id},h('div',{className:'qa-name'},pet.name),h('div',{className:'qa-back-row'},[...petIdleVariants(pet.id),petReactionFrames(pet.id,'tap'),petReactionFrames(pet.id,'hold')].map((frames,index)=>h('div',{className:'qa-cell',key:index},h('div',{className:'qa-label'},['idle-a','idle-b','tap','hold'][index]),h('div',{className:'qa-sub'},frames.map((frame,i)=>h('div',{key:i},matrix(frame)))))))))))
    window.drawPetSheet()
    return {checkedAt:new Date().toISOString(),source:'actual Chromium / Vite components; not rear-display hardware',pets,egg:{framesChecked:eggFramesChecked+4,bounds:eggBounds,sameClosedMask,exactSplitPreservesPaint},failures}
  })
  const screenshot=async(name)=>{await page.waitForTimeout(120);await page.locator('#art-inspect').screenshot({path:fileURLToPath(new URL(name,out))})}
  await screenshot('art-contact-sheet.png')
  await page.evaluate(()=>window.drawPetSheet('tap',1));await screenshot('art-tap-sheet.png')
  await page.evaluate(()=>window.drawPetSheet('hold',2));await screenshot('art-hold-sheet.png')
  await page.evaluate(()=>window.drawEggSheet());await screenshot('egg-contact-sheet.png')
  await page.evaluate(()=>window.drawRearSheet());await screenshot('back-motion-sheet.png')
  report.pageErrors=errors
  report.passed=report.failures.length===0 && errors.length===0
  await writeFile(new URL('art-resource-report.json',out),JSON.stringify(report,null,2))
  console.log(JSON.stringify({passed:report.passed,pets:report.pets.length,frontImages:252,rearSequences:48,egg:report.egg,failures:report.failures,pageErrors:errors},null,2))
  if(!report.passed) process.exitCode=1
} finally {
  await browser.close()
}
