declare module 'multicast-dns' {
  interface DnsQuestion {
    name: string;
    type: string;
    class?: string;
  }

  interface DnsAnswer {
    name: string;
    type: string;
    ttl?: number;
    data: string;
  }

  interface QueryPacket {
    questions?: DnsQuestion[];
  }

  interface MdnsInstance {
    on(event: 'query', listener: (query: QueryPacket) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    respond(packet: { answers: DnsAnswer[] }): void;
    destroy(): void;
  }

  function multicastDns(): MdnsInstance;
  export default multicastDns;
}
