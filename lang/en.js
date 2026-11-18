// English. To add a language: copy this file to lang/xx.js (xx = language code, e.g. de, it, es),
// translate the values on the right, change the first two lines, then add 'xx' to `languages` in settings.js.
// A value can be:
//   - a text with {placeholders}, which the app fills in;
//   - a { one, other } pair for words that change with a number (some languages also use few, many…);
//   - a function, for rules that need code (see 'ordinal').
// Any key missing from a language falls back to English.
self.CHRONO_LANGS = self.CHRONO_LANGS || {};
self.CHRONO_LANGS.en = {
  _name: 'English',      // shown in the language menu
  _locale: 'en-GB',      // used for dates and numbers

  'common.add': 'Add', 'common.remove': 'Remove', 'common.cancel': 'Cancel', 'common.done': 'Done', 'common.save': 'Save', 'common.undo': 'Undo',
  'riders.count': { one: '{n} rider', other: '{n} riders' },
  'runs.count': { one: '{n} run', other: '{n} runs' },
  'riders.unknown': '(unknown rider)',
  'ordinal': p => { const n = p.n, s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); },
  'role.admin': 'Admin', 'role.coach': 'Coach',

  'setup.notConfigured': 'The app is not connected to its database yet. Open <b>config.js</b> and enter your Supabase project URL and publishable key (see README, step 2).',
  'setup.libMissing': 'The Supabase library could not be loaded. Check the internet connection and reload the page.',

  'login.area': 'Coach area', 'login.clubArea': '{club} · coach area',
  'login.email': 'Email', 'login.password': 'Password', 'login.newPassword': 'Choose a password (at least 8 characters)',
  'login.signIn': 'Sign in', 'login.create': 'Create my account', 'login.sendLink': 'Send me a link', 'login.wait': 'One moment…',
  'login.mustBeAdded': 'Your email address must first be added by an admin.',
  'login.haveAccount': 'I already have an account', 'login.firstTime': 'First sign-in', 'login.forgot': 'Forgot password',
  'newpass.title': 'New password', 'newpass.label': 'Password (at least 8 characters)',
  'auth.wrong': 'Wrong email or password.',
  'auth.notConfirmed': 'Confirm your address first, using the email you received.',
  'auth.exists': 'An account already exists for this address: use “Sign in”.',
  'auth.rateLimit': 'Too many emails sent for now. Try again in an hour.',
  'auth.noNetwork': 'No network: signing in needs an internet connection.',
  'auth.refused': 'Refused: {msg}',
  'auth.notAllowed': 'Account not created. Ask an admin to check that this address is in the coach list.',
  'auth.checkEmail': 'Account created. Open the confirmation email, then sign in.',
  'auth.linkSent': 'If this address has an account, a link has just been sent to it.',

  'home.admin': 'Admin', 'home.signOut': 'Sign out',
  'home.upcoming': 'Today and upcoming', 'home.past': 'Past sessions',
  'home.noUpcoming': 'No session planned. Tap + to create one.', 'home.noPast': 'No past session yet.',
  'home.showArchived': 'Show archived sessions ({n})', 'home.hideArchived': 'Hide archived sessions ({n})',
  'home.newSession': 'New session', 'home.todayTag': 'Today', 'home.upcomingTag': 'Upcoming', 'home.archivedTag': 'Archived',

  'net.synced': 'Synced', 'net.offline': 'Offline', 'net.sending': 'Sending', 'net.reconnect': 'Sign-in needed',
  'net.pending': { one: '{n} waiting', other: '{n} waiting' },

  'session.back': 'Sessions', 'session.archived': 'archived', 'session.myPost': 'My post',
  'tab.chrono': 'Timing', 'tab.results': 'Results', 'tab.gpx': 'GPX track',
  'post.start': 'Start', 'post.split': 'Split', 'post.finish': 'Finish', 'post.both': 'Start/Fin.',
  'btn.start': 'Start', 'btn.stop': 'Stop', 'btn.split': 'Split', 'btn.lap': 'Lap', 'btn.finish': 'Finish',

  'chrono.onLap': 'Lap {lap} · last lap {time}',
  'chrono.atSplit': 'Split {i}: {time} · {rank} fastest',
  'chrono.running': 'Running',
  'chrono.stoppedAt': 'Stopped at {time} · lap or finish?',
  'chrono.cancelStop': 'Cancel the stop',
  'chrono.waitingStart': 'Time recorded, start not received yet',
  'chrono.runsBest': '{runs} · best {time}',
  'chrono.notStarted': 'Not started yet',
  'chrono.select': 'Select {name}',
  'chrono.waitHint': 'Waiting for a start. As soon as the coach at the start sends a rider off, the stopwatch runs here too. If the start does not arrive (weak network), still tap the dashed button when the rider passes: the time is computed once the start is received.',
  'chrono.groupStart': 'Group start', 'chrono.leaveGroup': 'Leave group start', 'chrono.selectAll': 'Select all',
  'chrono.startN': 'Start · {riders}', 'chrono.selectRiders': 'Select riders',
  'chrono.noRiders': 'No riders. Add some below.',
  'chrono.peopleBtn': 'Riders and settings', 'chrono.archive': 'Archive', 'chrono.unarchive': 'Unarchive',

  'results.none': 'No finished run yet. Times, best, average and slowest appear here.',
  'results.details': 'details', 'results.best': 'Best', 'results.avg': 'Avg.', 'results.max': 'Max',
  'results.splitN': 'split {i} {time}', 'results.lapN': 'lap {i} {time}',
  'results.delete': 'Delete', 'results.exportCsv': 'Export .csv', 'results.copy': 'Copy ranking',
  'csv.rank': 'Rank', 'csv.name': 'Name', 'csv.runs': 'Runs', 'csv.run': 'Run', 'csv.startTime': 'Start time', 'csv.time': 'Time', 'csv.seconds': 'Time (s)', 'csv.splits': 'Splits (s)', 'csv.laps': 'Laps (s)',

  'gpx.intro': 'After the session, import the track recorded by a bike computer or watch to get distance, climb and speeds. If you say which rider carried the device, the speed of each of their runs is computed from the start and finish times.',
  'gpx.import': 'Import a .gpx file',
  'gpx.distance': 'Distance', 'gpx.duration': 'Duration', 'gpx.avgSpeed': 'Avg. speed', 'gpx.maxSpeed': 'Max speed', 'gpx.climb': 'Climb', 'gpx.descent': 'Descent',
  'gpx.trackAria': 'Map of the track', 'gpx.speedAria': 'Speed along the track', 'gpx.speedAxis': '0 km · speed in km/h',
  'gpx.carriedBy': 'Device carried by', 'gpx.notSpecified': 'Not specified',
  'gpx.runsOf': 'Runs of {name}', 'gpx.noPoints': 'no GPS points during this run', 'gpx.runLine': '{m} m · avg. {avg} km/h · max {max} km/h',
  'gpx.noFinished': 'No finished run for this rider.', 'gpx.remove': 'Remove the track',
  'gpx.unreadable': 'This file has no readable GPX track.',

  'sheet.newTitle': 'New session', 'sheet.name': 'Session name', 'sheet.namePlaceholder': 'e.g. Rock garden descent', 'sheet.date': 'Date',
  'sheet.createAndPick': 'Create and choose riders', 'sheet.untitled': 'Untitled session',
  'sheet.addRider': 'Add a rider', 'sheet.typeName': 'Type a name',
  'sheet.addGroup': '+ All of “{group}”', 'sheet.createRider': '+ Create “{name}”', 'sheet.allIn': 'All club riders are already in the session.',
  'sheet.deleteSession': 'Delete session', 'sheet.confirmDelete': 'Confirm: delete the session and all its times',

  'admin.title': 'Admin', 'admin.subtitle': 'Club lists, for admins only',
  'admin.ridersTab': 'Riders ({n})', 'admin.coachesTab': 'Coaches ({n})',
  'admin.fullName': 'First and last name', 'admin.group': 'Group', 'admin.importCsv': 'Import a .csv',
  'admin.ridersCsvHelp': 'Format: one line per rider, columns name ; group (group is optional). Names already in the list are skipped.',
  'admin.noRiders': 'No riders yet.', 'admin.noGroup': 'No group',
  'admin.name': 'Name', 'admin.role': 'Role', 'admin.addCoach': 'Add coach',
  'admin.coachesCsvHelp': 'Format: name ; email ; role (admin or coach). Each coach then creates a password with “First sign-in”. These actions need a network connection.',
  'admin.accountCreated': 'account created', 'admin.notYet': 'not signed in yet',

  'footer.language': 'Language', 'footer.version': 'Version {v}', 'footer.checkUpdate': 'Check for updates',
  'update.ready': 'A new version of the app is ready.', 'update.reload': 'Reload',
  'update.checking': 'Checking for updates…', 'update.latest': 'You have the latest version.',
  'update.unavailable': 'Updates are only available on the installed site (https).',

  'toast.sessionExpired': 'Session expired: sign in again to send the waiting times.',
  'toast.rejected': 'The server refused a change ({msg}).',
  'toast.sessionGone': 'This session has been deleted.',
  'toast.serverUnreachable': 'Cannot reach the server right now.',
  'toast.notCoach': 'This account is not in the coach list.',
  'toast.signInAgain': 'Please sign in again. Your waiting times are kept.',
  'toast.waitSync': { one: '{n} change waiting: wait for the sync before signing out.', other: '{n} changes waiting: wait for the sync before signing out.' },
  'toast.noNetworkKept': 'No network right now. Times stay on the phone.',
  'toast.syncStarted': 'Sync started',
  'toast.archived': 'Session archived. It is still available at the bottom of the list.', 'toast.unarchived': 'Session unarchived',
  'toast.sessionDeleted': 'Session deleted',
  'toast.started': 'Start: {name}', 'toast.groupStarted': 'Group start: {riders}',
  'toast.split': 'Split {i} {name}: {time}', 'toast.splitEarly': 'Split recorded for {name}. The time appears once the start is received.',
  'toast.finished': 'Finish {name}: {time}', 'toast.finishEarly': 'Finish recorded for {name}. The time appears once the start is received.',
  'toast.lap': 'Lap {i} {name}: {time}',
  'toast.runDeleted': 'Run deleted', 'toast.copied': 'Ranking copied', 'toast.copyRefused': 'The browser refused to copy',
  'toast.riderRemoved': '{name} removed from the list. Past times are kept.',
  'toast.retryLater': 'No network: try again later.', 'toast.refused': 'Refused: {msg}',
  'toast.passwordSaved': 'Password saved',
  'toast.riderExists': '{name} is already in the list.',
  'toast.coachExists': 'This address is already in the list.',
  'toast.coachAdded': '{name} can now create a password with “First sign-in”.',
  'toast.ridersImported': p => p.n + (p.n === 1 ? ' rider' : ' riders') + ' imported' + (p.skipped ? ' · ' + p.skipped + ' already in the list' : ''),
  'toast.coachCsvEmpty': 'No valid line: name ; email ; role is needed.',
  'toast.coachesImported': { one: '{n} coach processed', other: '{n} coaches processed' }
};
