# Talon voice context blueprint for creator workflows

app: keynote
add slide: key(cmd-shift-n)
format text: key(cmd-t)
align center: key(cmd-shift-e)

app: numbers
new sheet: key(shift-f11)
insert column: key(ctrl-i c)
format text: key(cmd-t)
align center: key(cmd-shift-e)

app: pages
add page: key(cmd-enter)
format text: key(cmd-t)
align center: key(cmd-shift-e)

app: logic pro
split clip: key(cmd-t)
play timeline: key(space)
bounce project: key(cmd-b)
start render: key(cmd-b)

app: final cut pro
split clip: key(cmd-b)
blade tool: key(b)
play timeline: key(space)
start render: key(cmd-e)

app: motion
play timeline: key(space)
start render: key(cmd-e)

app: compressor
start render: key(cmd-enter)

app: home assistant
trigger routine {user.routine_name}: user.trigger_home_assistant_routine(routine_name)

app: canary mail
next email: key(j)
archive message: key(e)

app: google chat
next chat: key(j)
send chat: key(cmd-enter)
