These two mappings connect host ports to the two listeners inside the container. They use the same port numbers on both sides:

- `5678` leads to the debugpy listener from W1.4. VS Code attaches here in the next step.
- `8080` leads to the HTTP server from W1.6.

**Neither mapping names a host address, so Docker publishes both ports on all of the host's network interfaces, not only on `localhost`.** That matters most for 5678. Anyone who can connect to a debugpy port can run arbitrary code in the process. As written, any machine that can reach the developer's host on that port can connect, unless a firewall or Docker setup outside this repository blocks it. Writing `"127.0.0.1:5678:5678"` would limit it to the local machine. The same applies to 8080, which serves the files under `/app` (W1.6).

VS Code only needs `localhost:5678`, and that is what the next step connects to.

<!-- dspatch:details -->
Docker's published ports on Linux are usually set up through iptables rules that bypass host firewalls such as ufw. So a host firewall can't be relied on to hide a port published on all interfaces. That is general Docker behaviour. Nothing in this repository changes it.