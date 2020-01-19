const globby = require('globby')
const child_process = require('child_process')
const fs = require('fs')
const path = require('path')
require('string.prototype.matchall').shim()
const cliArgv = parseArgv() // 命令行上的参数
const fileArgv = {...( // 配置文件中的参数
  cliArgv.config === true
  ? getConfigInfo(qsPath(`config.txt`)).res
  : cliArgv.config === undefined
    ? undefined
    : getConfigInfo(qsPath(cliArgv.config)).res
)}
const userArgv = { // 合并文件参数和命令行参数
  ...fileArgv,
  ...cliArgv,
}
const appArgv = { // 默认值处理
  size: userArgv.size || '4.5GB',
  path: (userArgv.path || 'iso').replace(/\\/g, '/'),
  outPath: (userArgv.outPath || 'iso_out').replace(/\\/g, '/'),
  delBigFile: userArgv.delBigFile || false,
  delIso: userArgv.delIso || false,
  zipDelRaw: userArgv.zipDelRaw || false,
  zipPw: userArgv.zipPw || 'ziptzipt',
  ignoreErr: userArgv.ignoreErr || false,
  coverExt: userArgv.coverExt || 'dat',
  testCmd: userArgv.testCmd || false,
  exe: (userArgv.exe || 'split').split(','),
  errLogFile: qsPath(userArgv.errLogFile || `errLog.txt`),
  taskStateFile: qsPath(userArgv.taskStateFile || `taskState.json`),
  tsMuxeR: qsPath(userArgv.tsMuxeR || `tsMuxeR_2.6.12/tsMuxeR.exe`),
  rar: qsPath(userArgv.rar || `WinRARx64.exe`),
  pfmi: qsPath(userArgv.pfmi || `pfm_install.exe`),
}

console.log('应用参数:', appArgv)

{ // 关联参数特殊处理
  if((appArgv.help === true) || (process.argv[2] === undefined)) {
    const cliName = 'zipt'
    print(
`
用于分割 iso 中的大文件, 以及压缩解压目录.

参数:
size=4.5GB -- 分割为多少大小, 默认 4.5GB
path=iso -- 要处理的目录, 默认为当前所在位置的 iso 目录
outPath=iso_out -- 处理结果输出目录, 默认为当前所在位置的 iso_out 目录
delBigFile=<false|true> -- 分割完成后是否删除 iso 中的大文件
delIso=<false|true> -- 分割完成后是否删除 iso 文件, 已挂载状态不能删除
zipDelRaw=<false|true> -- 压缩或解压完成后是否删除源文件, 默认 false
zipPw=ziptzipt -- 压缩或解压密码, 默认 ziptzipt
ignoreErr=<false|true> -- 是否忽略错误继续执行, 默认 false
exe=<split|zip|unZip> -- 要使用的功能, 默认仅 split, 多个使用逗号分割
coverExt=<dat|exe|false> -- 使用某个文件类型覆盖, 默认 dat. false 不使用, exe 可以自动还原但可能会收到安全提示
testCmd=<false|true> -- 仅显示命令而不运行
config=config.txt -- 使用配置文件指定参数, 命令行参数优先于文件
help -- 显示使用方法

示例:
${cliName} --
`)
    return
  }

}
const config = {
  ...appArgv,
}
const taskState = JSON.parse(fs.readFileSync(config.taskStateFile).toString() || `{}`)
new Promise(async () => {
  init()
  const fnList = {split, zip, unZip, cover}
  config.exe.forEach(item => fnList[item](config.path))
})

function cover(dir) {
  const allFile = globby.sync(`${dir}/**/**`)
  for (let index = 0; index < allFile.length; index++) {
    const file = qsPath(allFile[index])
    if(hasFile(`${file}.${config.coverExt}`)) {
      console.log(`跳过, 已存处理的文件 ${file}`)
      continue
    }
    const fileDir = qsPath(path.dirname(file))
    const outPath = fileDir
      .replace(qsPath(dir), qsPath(config.outPath)) // 替换为输出目录
    if(hasFile(outPath) === false) { // 如果目标目录不存在则创建
      const cmdCreateDir = `md "${outPath}"`
      runCmd(cmdCreateDir, {exit: false, des: `创建目录 ${outPath}`})
    }
    const fileName = path.basename(file)
    const coverName = `${outPath}\\${fileName}.${config.coverExt}`
    const cmdCover = `copy /y /b "${qsPath('coverExt.' + config.coverExt)}" + "${file}" "${coverName}"`
    if(runCmd(cmdCover, {des: `覆盖文件类型 ${fileName}`}).status === 0) {
      const cmdDelZip = `del /s /q "${file}"`
      runCmd(cmdDelZip, {des: `清理文件 ${fileName}`})
    }

  }
  
  
}

function parseArgv(arr) {
  return (arr || process.argv.slice(2)).reduce((acc, arg) => {
    let [k, v] = arg.split('=')
    acc[k] = v === undefined // 没有值时, 则表示为 true
      ? true
      : (
        /^(true|false)$/.test(v) // 转换指明的 true/false
        ? v === 'true'
        : (
          /[\d|\.]+/.test(v)
          ? (isNaN(Number(v)) ? v : Number(v)) // 如果转换为数字失败, 则使用原始字符
          : v
        )
      )
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

function hasFile(filePath) {
  return fs.existsSync(filePath)
}

async function split(dir) {
  const handleDir = `${dir}/**/*.*`.replace(/\/\//g, '/')

  const paths = globby.sync(handleDir).filter(item => item.match(/\.iso$/i))
  console.log({paths})
  for (let index = 0; index < paths.length; index++) {
    const isoFile = paths[index]
    const outPath = qsPath(isoFile.replace(/\.iso$/i, ''))
      .replace(qsPath(dir), qsPath(config.outPath)) // 替换为输出目录
    const outPathDir = path.dirname(outPath)
    if(hasFile(outPathDir) === false) { // 如果目标目录不存在则创建
      const cmdCreateDir = `md "${outPathDir}"`
      runCmd(cmdCreateDir, {exit: false, des: `创建目录 ${outPathDir}`})
    }
    if(taskState[outPath] === 'ok') {
      console.log(`跳过, 已完成的 iso ${outPath}`)
      continue
    }
    const cmdClearUniso = `rd /s /q "${outPath}" 2>nul`
    runCmd(cmdClearUniso, {exit: false, des: `清理目录 ${outPath}`})
    function mountIso(isoFile) { // 挂载 iso 并创建目录结构
      let mountPath
      try {
        const cmdMountIso = `pfm mount -a -r -w -i "${qsPath(isoFile)}"`
        runCmd(cmdMountIso, {des: `挂载 iso 文件 "${isoFile}"`})
        const {status, text} = runCmd(`pfm list`, {des: `获取挂载目录 "${isoFile}"`, method: 'execSync'})
        const re = new RegExp(`${qsPath(isoFile).replace(/\\/g, '\\\\')}\\s+(.*)`)
        const now = `/${Date.now()}/`
        mountPath = text.replace(qsPath(isoFile), now).match(new RegExp(`${now}\\s+(.*)`))[1]
        console.log('mountPathmountPath', mountPath)

        const cmdCopyDir = `xcopy /y /t /e "${mountPath}" "${outPath}\\"`
        runCmd(cmdCopyDir, {des: `复制目录结构 "${isoFile}"`})
        
        const isoFiles = globby.sync(`${mountPath.replace(/\\/g, '/')}/**/**`) // 在 iso 目录中查找可以分割的大文件
        // console.log('处理列表: \r\n', isoFiles)
        isoFiles.forEach(isoFileItem => {
          const cmdLinkFile = `mklink "${qsPath(isoFileItem).replace(qsPath(mountPath), qsPath(outPath))}" "${qsPath(isoFileItem)}"`
          runCmd(cmdLinkFile, {des: `创建 iso 中的文件关联 "${isoFile}"`})
        })
      } catch (error) {
        console.error('挂载出错', error)
        runCmd(`pfm unmount "${qsPath(isoFile)}"`, {des: `卸载 iso 文件 "${isoFile}"`})
        process.exit()
        return undefined
      }
    }
    const disk = outPath.match(/(.*:)/)[1]
    const cmdTestDisk = `chkntfs ${disk}`
    if(runCmd(cmdTestDisk, {exit: false, des: `检查磁盘格式是否支持链接 ${disk}`}).status === 0) {
      mountIso(isoFile)
    } else {
      const cmdUniso = `"${config.rar}" x "${qsPath(isoFile)}" "${outPath}\\" -ibck -y`
      runCmd(cmdUniso, {des: `解压 iso 文件 "${isoFile}"`})
    }

    // const findBigFilePaths = globby.sync(`${outPath.replace(/\\/g, '/')}/**/*.*`) // 在 iso 目录中查找可以分割的大文件
    //   .filter(item => (
    //     !item.match(/\.split\./)
    //     && item.match(/\.(evo|vob|mpg|mkv|mka|mp4|mov|ts|m2ts)$/i)
    //     && parseFloat(fs.statSync(item).size) > size2b(config.size)
    //   ))
    // console.log('处理列表: \r\n', findBigFilePaths)
    // for (let index = 0; index < findBigFilePaths.length; index++) {
    //   const item = findBigFilePaths[index];
    //   const file = item.replace(/\//g, '\\')
    //   if(taskState[file] === 'ok') {
    //     console.log(`跳过, 已分割的文件 "${file}"`)
    //     continue
    //   }
    //   const cmdSplit = `"${config.tsMuxeR}" "${getMetaInfo({file, size: config.size}).metaFile}" "${file}.m2ts"`
    //   const {status} = runCmd(cmdSplit, {des: `分割 iso 中的大文件 "${file}"`})
    //   if(status === 0) {
    //     taskState[file] = 'ok' // 保留状态运行状态
    //     fs.writeFileSync(config.taskStateFile, JSON.stringify(taskState, null, 2))
    //   }
    //   if(status === 0 && config.delBigFile === true) { // 上一条命令运行成功才进行删除操作
    //     const cmdDel = `del /s /q "${file}"`
    //     runCmd(cmdDel, {des: `删除分割完成后的大文件 "${file}"`})
    //   }

    //   if((index + 1) === findBigFilePaths.length && findBigFilePaths.reduce((res, item) => {
    //     return taskState[item.replace(/\//g, '\\')] === 'ok' ? res + 1 : res
    //   }, 0)) { // 保留状态运行状态
    //     taskState[outPath] = 'ok'
    //     fs.writeFileSync(config.taskStateFile, JSON.stringify(taskState, null, 2))
    //     if(config.delIso === true) {
    //       const cmdDelIso = `del /s /q "${qsPath(isoFile)}"`
    //       runCmd(cmdDelIso, {des: `删除已分割后的 iso 文件 "${isoFile}"`})
    //     }
    //   }

    // }
  }
}

function init() {
  if(runCmd(`pfm -h 2>nul||echo nopfm`, {method: 'execSync'}).text.includes('nopfm')) {
    runCmd(`${config.pfmi} /install`, {des: `安装 pfm`}) // 需要使用管理员身份运行, 因为需要注册驱动
  }
}

function qsPath(addr = '', relativePath = `${__dirname}`) {
  const {normalize, resolve} = path
  addr = [relativePath].concat(Array.isArray(addr) ? addr : [addr])
  return normalize(resolve(...addr))
}


function zip(dir) { // 先跳转到文件目录再使用文件名进行压缩, 这样可以避免压缩多于的路径
  const allFile = globby.sync(`${dir}/**/*.jpg`)
  for (let index = 0; index < allFile.length; index++) {
    const file = qsPath(allFile[index])
    if(hasFile(`${file}.zip`)) {
      console.log(`跳过, 已存在压缩文件 ${file}`)
      continue
    }
    const fileDir = qsPath(path.dirname(file))
    const outPath = fileDir
      .replace(qsPath(dir), qsPath(config.outPath)) // 替换为输出目录
    if(hasFile(outPath) === false) { // 如果目标目录不存在则创建
      const cmdCreateDir = `md "${outPath}"`
      runCmd(cmdCreateDir, {exit: false, des: `创建目录 ${outPath}`})
    }
    const fileName = path.basename(file)
    const zipPath = `${outPath}\\${fileName}.zip`
    const cmdZip = `cd /d "${fileDir}" && "${config.rar}" a "${zipPath}" "${fileName}" ${config.zipDelRaw === true ? '-df' : ''} -ibck -m0 -hp${config.zipPw}`
    if(runCmd(cmdZip, {des: `压缩 "${fileName}"`}).status === 0 && config.coverExt !== false) { // 压缩后进行文件类型覆盖
      const cmdCover = `copy /y /b "${qsPath('coverExt.' + config.coverExt)}" + "${zipPath}" "${zipPath}.${config.coverExt}"`
      if(runCmd(cmdCover, {des: `覆盖文件类型 ${fileName}`}).status === 0) {
        const cmdDelZip = `del /s /q "${zipPath}"`
        runCmd(cmdDelZip, {des: `清理文件 ${fileName}`})
      }
    }

  }
}

function unZip(dir) {
  const allFile = globby.sync(`${dir}/**/*.zip`)
  for (let index = 0; index < allFile.length; index++) {
    const file = allFile[index]
    const fileDir = qsPath(path.dirname(file))
    const outPath = fileDir
      .replace(qsPath(dir), qsPath(config.outPath)) // 替换为输出目录
    if(hasFile(outPath) === false) { // 如果目标目录不存在则创建
      const cmdCreateDir = `md "${outPath}"`
      runCmd(cmdCreateDir, {exit: false, des: `创建目录 ${outPath}`})
    }
    const fileName = path.basename(file)
    const cmdUnZip = `cd /d "${fileDir}" && "${config.rar}" x "${fileName}" "${outPath}" -ibck -hp${config.zipPw} -y`
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
  /**
  raw 示例:
    Network Optix tsMuxeR.  Version 2.6.12. www.networkoptix.com
    Track ID:    224
    Stream type: MPEG-2
    Stream ID:   V_MPEG-2
    Stream info: Profile: Main@8. Resolution: 720:480i. Frame rate: 29.97
    Stream lang:

    Track ID:    32
    Can't detect stream type

    Track ID:    128
    Stream type: AC3
    Stream ID:   A_AC3
    Stream info: Bitrate: 192Kbps Sample Rate: 48KHz Channels: 2
    Stream lang:
    Stream delay: -372
  `
  infoArr 示例:
    [
      {
        "Track ID": "224",
        "Stream type": "MPEG-2",
        "Stream ID": "V_MPEG-2",
        "Stream info": "Profile: Main@8. Resolution: 720:480i. Frame rate: 29.97",
        "Stream lang": ""
      },
      {
        "Track ID": "32"
      },
      {
        "Track ID": "128",
        "Stream type": "AC3",
        "Stream ID": "A_AC3",
        "Stream info": "Bitrate: 192Kbps Sample Rate: 48KHz Channels: 2",
        "Stream lang": "",
        "Stream delay": "-372"
      }
    ]
   */
  const infoArr = raw.replace(/(Track ID:)/gm, '\n_\n$1') // 把文件信息根据 Track ID 转换为对象
    .split('\n_\n')
    .filter(item => item.match(/^Track ID:/))
    .map(item => (
      [...item.matchAll(/^(.*?):(.*)/gm)]
        .reduce(
          (res, item) => (
            {
              ...res,
              [item[1]]: item[2].trim(),
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

function getConfigInfo(file) { // 获取配置文件中的对象
  /**
   * 配置文件示例:
      ;分号开头的行是注释
      size=4.5GB
      path=iso
      delBigFile=false
      delIso=false
      zipDelRaw=false
      zipPw=ziptzipt
      ignoreErr=false
      exe=split
   * 返回:
      {
        size: '4.5GB',
        path: 'iso',
        delBigFile: 'false',
        delIso: 'false',
        zipDelRaw: 'false',
        zipPw: 'ziptzipt',
        ignoreErr: 'false',
        exe: 'split'
      }
   */
  const str = fs.readFileSync(file, 'utf8')
  const arr = []
  const rawObj = str.split('\n').filter(item => item.trim() && !(item.trim()).match(/^;/))
    .reduce(
      (res, item) => {
        item = item.trim()
        let [, key, val] = item.match(/^(.*?)=(.*)/)
        val = val.trim() // 去除 val 的左右空白
        arr.push(`${key}=${val}`)
        return {
          ...res,
          [key]: val,
        }
      },
      {}
    )
  const res = parseArgv(arr)
  return {rawObj, res}
}

function runCmd(cmd, cfg = {}) {
  const {exit = true, des = '运行命令', method = 'spawnSync', showOut = true} = cfg
  console.info(`${des}\r\n${cmd}`)
  if(method === 'execSync') {
    try {
      let text = child_process.execSync(cmd).toString().trim()
      showOut && console.log(text)
      return {
        text,
        status: 0,
      }
    } catch (error) {
      return {
        status: error.status,
        stderr: error.stderr.toString(),
      }
    }
  }
  const res = config.testCmd === false ? child_process.spawnSync(cmd, {stdio: 'inherit', shell: true, maxBuffer: 9e9}) : {status: 0}
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
