const globby = require('globby')
const child_process = require('child_process')
const fs = require('fs')
const path = require('path')
const matchAll = require('string.prototype.matchall')
const userArgv = parseArgv()
const argv = {
  ...userArgv,
  size: userArgv.size || '4.5GB',
  path: userArgv.path || 'iso',
  delBigFile: userArgv.delBigFile || false,
  delIso: userArgv.delIso || false,
  zipDelRaw: userArgv.zipDelRaw || false,
  zipPw: userArgv.zipPw || 'ziptzipt',
  ignoreErr: userArgv.ignoreErr || false,
  exe: (userArgv.exe || 'split').split(','),
  errLogFile: qsPath(`errLog.txt`),
  taskStateFile: qsPath(`taskState.json`),
  tsMuxeR: qsPath(`tsMuxeR_2.6.12/tsMuxeR.exe`),
  rar: qsPath(`WinRAR.exe`),
}

console.log('userArgv', argv)

{ // 关联参数特殊处理
  if((argv.help === true) || (process.argv[2] === undefined)) {
    const cliName = 'zipt'
    print(
`
用于分割 iso 中的大文件, 以及压缩解压目录.

参数:
size=4.5GB -- 分割为多少大小, 默认 4.5GB
path=iso -- 要处理的目录, 默认为当前所在位置的 iso 目录
delBigFile=<false|true> -- 分割完成后是否删除 iso 中的大文件
delIso=<false|true> -- 分割完成后是否删除 iso 文件, 已挂载状态不能删除
zipDelRaw=<false|true> -- 压缩或解压完成后是否删除源文件, 默认 false
zipPw=ziptzipt -- 压缩或解压密码, 默认 ziptzipt
ignoreErr=<false|true> -- 是否忽略错误继续执行, 默认 false
exe=<split|zip|unZip> -- 要使用的功能, 默认仅 split, 多个使用逗号分割
help -- 显示使用方法

示例:
${cliName} -- 
`)
    return
  }

}
const config = {
  ...argv,
}
const taskState = JSON.parse(fs.readFileSync(config.taskStateFile).toString() || `{}`)
new Promise(async () => {
  const fnList = {split, zip, unZip}
  config.exe.forEach(item => fnList[item](config.path))
})

function parseArgv() {
  return process.argv.slice(2).reduce((acc, arg) => {
    let [k, v] = arg.split('=')
    acc[k] = v === undefined ? true : /true|false/.test(v) ? v === 'true' : /[\d|\.]+/.test(v) ? Number(v) : v
    return acc
  }, {})
}

function size2b(size = '1kb') { // 存储单位转换, 例 1KiB => 1024
  size = size.trim(size)
  const sizeMap = ['K', 'M', 'G'] // 支持的单位
  const power = sizeMap.findIndex(item => item.toUpperCase() === size.replace(/.*?([a-zA-Z]).*/, '$1').toUpperCase()) + 1 // 幂
  const base = size.match(/.*?[a-zA-Z]([iI])/) ? 1024 : 1000 // 底数, 根据 i 标志设置进率, 1MB 和 1MiB 不同
  const res = parseFloat(size) * Math.pow(base, power)
  return res
}

function print(...arg) {
  return console.log(...arg)
}

async function split(dir) {
  const handleDir = `${dir}/**/*.*`.replace(/\/\//g, '/')
  
  const paths = globby.sync(handleDir).filter(item => item.match(/\.iso$/i))
  console.log({paths})
  for (let index = 0; index < paths.length; index++) {
    const isoFile = paths[index]
    const outPath = qsPath(isoFile.replace(/\.iso$/i, ''))
    if(taskState[outPath] === 'ok') {
      console.log(`跳过, 已完成的 iso ${outPath}`)
      continue
    }
    const cmdClearUniso = `rd /s /q "${outPath}" 2>nul`
    runCmd(cmdClearUniso, {exit: false, des: `清理目录 ${outPath}`})
    const cmdUniso = `"${config.rar}" x "${qsPath(isoFile)}" "${outPath}\\" -ibck -y` // 解压 iso
    runCmd(cmdUniso, {des: `解压 iso 文件 "${isoFile}"`})
    const findBigFilePaths = globby.sync(`${outPath.replace(/\\/g, '/')}/**/*.*`) // 在 iso 目录中查找可以分割的大文件
      .filter(item => (
        !item.match(/\.split\./)
        && item.match(/\.(evo|vob|mpg|mkv|mka|mp4|mov|ts|m2ts)$/i)
        && parseFloat(fs.statSync(item).size) > size2b(config.size)
      ))
    console.log('处理列表: \r\n', findBigFilePaths)
    for (let index = 0; index < findBigFilePaths.length; index++) {
      const item = findBigFilePaths[index];
      const file = item.replace(/\//g, '\\')
      if(taskState[file] === 'ok') {
        console.log(`跳过, 已分割的文件 "${file}"`)
        continue
      }
      const cmdSplit = `"${config.tsMuxeR}" "${getMetaInfo({file, size: config.size}).metaFile}" "${file}.m2ts"`
      const {status} = runCmd(cmdSplit, {des: `分割 iso 中的大文件 "${file}"`})
      if(status === 0) {
        taskState[file] = 'ok' // 保留状态运行状态
        fs.writeFileSync(config.taskStateFile, JSON.stringify(taskState, null, 2))
      }
      if(status === 0 && config.delBigFile === true) { // 上一条命令运行成功才进行删除操作
        const cmdDel = `del /s /q "${file}"`
        runCmd(cmdDel, {des: `删除分割完成后的大文件 "${file}"`})
      }

      if((index + 1) === findBigFilePaths.length && findBigFilePaths.reduce((res, item) => {
        return taskState[item.replace(/\//g, '\\')] === 'ok' ? res + 1 : res
      }, 0)) { // 保留状态运行状态
        taskState[outPath] = 'ok'
        fs.writeFileSync(config.taskStateFile, JSON.stringify(taskState, null, 2))
        if(config.delIso === true) {
          const cmdDelIso = `del /s /q "${qsPath(isoFile)}"`
          runCmd(cmdDelIso, {des: `删除已分割后的 iso 文件 "${isoFile}"`})
        }
      }

    }
  }
}

function qsPath(addr = '', relativePath = `${__dirname}`) {
  const {normalize, resolve} = path
  addr = [relativePath].concat(Array.isArray(addr) ? addr : [addr])
  return normalize(resolve(...addr))
}


function zip(dir) { // 先跳转到文件目录再使用文件名进行压缩, 这样可以避免压缩多于的路径
  const allFile = globby.sync(`${dir}/**/*.*`)
  for (let index = 0; index < allFile.length; index++) {
    const file = qsPath(allFile[index])
    if(hasFile(`${file}.zip`)) {
      console.log(`跳过, 已存在压缩文件 ${file}`)
      continue
    }
    const fileDir = qsPath(path.dirname(file))
    const fileName = path.basename(file)
    const cmdZip = `cd /d "${fileDir}" && "${config.rar}" a "${fileName}.zip" "${fileName}" ${config.zipDelRaw === true ? '-df' : ''} -ibck -m0 -hp${config.zipPw}`
    runCmd(cmdZip, {des: `压缩 "${fileName}"`})
  }
}

function unZip(dir) {
  const allFile = globby.sync(`${dir}/**/*.zip`)
  for (let index = 0; index < allFile.length; index++) {
    const file = allFile[index]
    const fileDir = qsPath(path.dirname(file))
    const fileName = path.basename(file)
    const cmdUnZip = `cd /d "${fileDir}" && "${config.rar}" x "${fileName}" -ibck -hp${config.zipPw} -y`
    const {status} = runCmd(cmdUnZip, {des: `解压 "${fileName}"`})
    if(status === 0 && config.zipDelRaw === true) {
      const cmdDelZip = `cd /d "${fileDir}" && del /s /q "${fileName}"`
      runCmd(cmdDelZip, {des: `删除已经解压的过的 zip 文件 "${fileName}"`})
    }
  }
}

function getMetaInfo({file, size}) { // 获取文件信息并生成 meta 文件
  const cmd = `"${config.tsMuxeR}" "${file}"`
  let raw = child_process.execSync(cmd).toString().trim()
  const infoArr = raw.replace(/(Track ID:)/gm, '\n_\n$1')
    .split('\n_\n')
    .filter(item => item.match(/^Track ID:/))
    .map(item => (
      [...matchAll(item, /^(.*?):(.*)/gm)]
        .reduce(
          (res, item) => (
            {
              ...res,
              ...{[item[1]]: item[2].trim()},
            }
          ),
          {}
        )
    ))
  const out = `MUXOPT --no-pcr-on-video-pid --new-audio-pes --vbr  --split-size=${size} --vbv-len=500\r\n`
    + infoArr.map(item => (
      item[`Stream ID`]
        ? `${item[`Stream ID`]}, "${file}",${item[`Stream delay`] ? ` timeshift=${item[`Stream delay`]}ms,` : ''} track=${item[`Track ID`]}`
        : ''
    )).join(`\r\n`)
  const metaFile = require('os').tmpdir() + require('crypto').createHash('md5').update(out).digest('hex') + '.txt'
  fs.writeFileSync(metaFile, out)
  const res = {
    infoArr,
    raw,
    out,
    metaFile,
  }
  console.log(res.raw)
  console.log(res.out)
  console.log(res.infoArr)
  return res
}
function runCmd(cmd, cfg = {}) {
  const {exit = true, des = '运行命令'} = cfg
  console.info(`${des}\r\n${cmd}`)
  const res = child_process.spawnSync(cmd, {stdio: 'inherit', shell: true, maxBuffer: 9e9})
  const { status } = res
  console.log({status})
  if(status !== 0 && exit) {
    console.error('运行出错', {cmd, res})
    fs.appendFileSync(config.errLogFile, `${new Date().toLocaleString()} | ${status} | ${cmd}`)
    if(config.ignoreErr === false) {
      process.exit()
    }
  }
  return res
}
function hasFile(filePath) {
  const fs = require('fs')
  return fs.existsSync(qsPath(filePath))
}