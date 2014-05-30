*Untitled*

**The server**

The server is meant to support two protocols: a lightweight chat protocol - UMP - and IRC, as a fallback. The current version only supports the essential features of IRC, notably:

* PASS, NICK, USER
* PING/PONG
* PRIVMSG
* MODE
* JOIN
* TOPIC
* NAMES
* LIST
* INVITE
* TIME
* VERSION
* KICK

**Connecting to the server**

The server accepts unencrypted connections on port 6667. To connect, simply type `telnet [host] 6667` in a terminal: for example, `telnet 192.168.1.103 6667`.