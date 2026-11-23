import assert from "node:assert/strict"
import { test } from "node:test"
import {
  buildAgentApiUrl,
  isVirtualNetworkInterface,
  rankLanAddressCandidates,
  selectAgentAddress,
  type NetworkInterfaceMap,
} from "../lib/local-control-server"

const ipv4 = (address: string) => ({ address, family: "IPv4", internal: false })

test("多网卡：真实物理网卡排在 Hyper-V / WSL / Docker / VPN 之前", () => {
  const interfaces: NetworkInterfaceMap = {
    "vEthernet (WSL (Hyper-V firewall))": [ipv4("172.28.96.1")],
    "Hyper-V Virtual Ethernet Adapter": [ipv4("172.20.0.1")],
    "Docker Desktop": [ipv4("172.17.0.1")],
    "Tailscale": [ipv4("100.101.102.103")],
    "OpenVPN TAP-Windows6": [ipv4("10.8.0.6")],
    "以太网": [ipv4("192.168.1.23")],
    "Wi-Fi": [ipv4("192.168.1.24")],
  }

  const ranked = rankLanAddressCandidates(interfaces)
  assert.equal(ranked.length, 7)
  assert.equal(ranked[0], "192.168.1.23", "首个候选必须是真实物理网卡地址")
  assert.deepEqual(ranked.slice(0, 2).sort(), ["192.168.1.23", "192.168.1.24"])
  const physical = new Set(["192.168.1.23", "192.168.1.24"])
  assert.ok(ranked.slice(2).every((address) => !physical.has(address)), "虚拟网卡不得排在物理网卡之前")
  for (const virtual of ["vEthernet (WSL (Hyper-V firewall))", "Hyper-V Virtual Ethernet Adapter", "Docker Desktop", "Tailscale", "OpenVPN TAP-Windows6"]) {
    assert.equal(isVirtualNetworkInterface(virtual), true, virtual)
  }
  for (const physicalName of ["以太网", "Wi-Fi", "Ethernet 2", "WLAN"]) {
    assert.equal(isVirtualNetworkInterface(physicalName), false, physicalName)
  }
})

test("没有可用地址时返回空列表，Agent 地址回退回环而不是编造", () => {
  const onlyLoopback = rankLanAddressCandidates({
    "Loopback Pseudo-Interface 1": [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    "以太网": [{ address: "169.254.10.2", family: "IPv4", internal: false }],
  })
  assert.deepEqual(onlyLoopback, [])
  assert.deepEqual(rankLanAddressCandidates({}), [])
  assert.equal(selectAgentAddress("lan", "0.0.0.0", onlyLoopback), null)
  assert.equal(buildAgentApiUrl("lan", 8443, onlyLoopback, "0.0.0.0"), "http://127.0.0.1:8443")
})

test("过滤 IPv6、回环、APIPA 与重复地址", () => {
  const ranked = rankLanAddressCandidates({
    "以太网": [
      ipv4("169.254.10.2"),
      { address: "fe80::1", family: "IPv6", internal: false },
      ipv4("192.168.1.23"),
      ipv4("192.168.1.23"),
      { address: "127.0.0.1", family: "IPv4", internal: true },
      { address: "192.168.1.99", family: "4", internal: false },
    ],
  })
  assert.deepEqual(ranked, ["192.168.1.23", "192.168.1.99"])
})

test("写入安装信息的地址与绑定地址一致：绑定具体网卡时不做二次挑选", () => {
  const addresses = ["192.168.1.23", "10.8.0.6"]
  assert.equal(selectAgentAddress("lan", "10.8.0.6", addresses), "10.8.0.6")
  assert.equal(buildAgentApiUrl("lan", 8443, addresses, "10.8.0.6"), "http://10.8.0.6:8443")
  assert.equal(selectAgentAddress("lan", "0.0.0.0", addresses), "192.168.1.23")
  assert.equal(buildAgentApiUrl("lan", 8443, addresses, "0.0.0.0"), "http://192.168.1.23:8443")
  assert.equal(selectAgentAddress("lan", undefined, addresses), "192.168.1.23")
  assert.equal(selectAgentAddress("loopback", "192.168.1.23", addresses), null)
  assert.equal(buildAgentApiUrl("loopback", 8443, addresses, "127.0.0.1"), "http://127.0.0.1:8443")
})

test("候选顺序与网卡枚举顺序无关", () => {
  const first = rankLanAddressCandidates({ "以太网": [ipv4("192.168.0.5")], "Docker Desktop": [ipv4("172.17.0.1")] })
  const second = rankLanAddressCandidates({ "Docker Desktop": [ipv4("172.17.0.1")], "以太网": [ipv4("192.168.0.5")] })
  assert.deepEqual(first, second)
  assert.equal(first[0], "192.168.0.5")
})
