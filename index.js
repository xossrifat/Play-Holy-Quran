const { Client, GatewayIntentBits } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ytdl = require('ytdl-core');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Music queue
let musicQueue = [];

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

// Function to play next track in queue
const playNext = (connection, player) => {
    if (musicQueue.length > 0) {
        const filePath = musicQueue.shift(); // Get the next track in the queue
        const resource = createAudioResource(fs.createReadStream(filePath));
        player.play(resource);

        player.on('error', (error) => {
            console.error('Error with player:', error);
        });

        player.on(AudioPlayerStatus.Idle, () => {
            playNext(connection, player); // Play the next song in the queue
        });
    } else {
        connection.destroy(); // Disconnect if no songs are left
    }
};

client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('!') || message.author.bot) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Command to play a local audio file from the music folder
    if (command === 'play') {
        const fileName = args[0];
        if (!fileName) {
            return message.reply('Please provide the name of the audio file to play.');
        }

        const filePath = path.join(__dirname, 'music', fileName);

        if (!fs.existsSync(filePath)) {
            return message.reply('The specified file does not exist in the music folder.');
        }

        if (!message.member.voice.channel) {
            return message.reply('You need to be in a voice channel to play the audio!');
        }

        try {
            const connection = joinVoiceChannel({
                channelId: message.member.voice.channel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            // Add the song to the queue
            musicQueue.push(filePath);
            if (musicQueue.length === 1) {
                // If this is the first song in the queue, start playing
                const player = createAudioPlayer();
                connection.subscribe(player);
                playNext(connection, player);
            }

            message.reply(`Added ${fileName} to the queue.`);
        } catch (error) {
            console.error('Error while playing local audio:', error);
            message.reply('An error occurred while trying to play the audio.');
        }
    }

    // Command to download a YouTube video as an MP3 file
    if (command === 'download') {
        const url = args[0];
        if (!ytdl.validateURL(url)) {
            return message.reply('Please provide a valid YouTube URL.');
        }

        const videoID = ytdl.getVideoID(url);
        const outputPath = path.join(__dirname, 'music', `${videoID}.mp3`);
        const tempFilePath = path.join(__dirname, 'music', `${videoID}_temp.mp4`);

        message.reply('Downloading the YouTube audio, please wait...');

        try {
            // Download the video
            const stream = ytdl(url, { filter: 'audioonly' });
            const writeStream = fs.createWriteStream(tempFilePath);

            stream.pipe(writeStream);

            writeStream.on('finish', () => {
                console.log('YouTube video downloaded successfully.');

                // Convert to MP3
                exec(
                    `ffmpeg -i "${tempFilePath}" -codec:a libmp3lame -b:a 192k "${outputPath}"`,
                    (error, stdout, stderr) => {
                        if (error) {
                            console.error('Error converting the audio file:', stderr);
                            return message.reply('An error occurred while converting the audio file.');
                        }

                        console.log('Audio file converted successfully.');

                        // Delete temporary file
                        fs.unlink(tempFilePath, (err) => {
                            if (err) console.error('Error deleting temporary file:', err);
                        });

                        message.reply(`Download complete! File saved as: ${videoID}.mp3`);

                        // Add the downloaded song to the queue
                        if (message.member.voice.channel) {
                            const filePath = outputPath;
                            musicQueue.push(filePath);
                            if (musicQueue.length === 1) {
                                // If this is the first song in the queue, start playing
                                const connection = joinVoiceChannel({
                                    channelId: message.member.voice.channel.id,
                                    guildId: message.guild.id,
                                    adapterCreator: message.guild.voiceAdapterCreator,
                                });

                                const player = createAudioPlayer();
                                connection.subscribe(player);
                                playNext(connection, player);
                            }
                        }
                    }
                );
            });

            stream.on('error', (error) => {
                console.error('Error downloading YouTube audio:', error);
                message.reply('An error occurred while downloading the YouTube audio.');
            });
        } catch (error) {
            console.error('Error during the download process:', error);
            message.reply('An error occurred while downloading the YouTube audio.');
        }
    }

    // Command to announce when someone joins the channel
    if (command === 'announcejoin') {
        const channelName = args[0];
        if (!message.guild) return;
        const channel = message.guild.channels.cache.find(ch => ch.name === channelName && ch.isVoice());

        if (channel) {
            // Play TTS when someone joins
            client.on('voiceStateUpdate', (oldState, newState) => {
                if (!oldState.channel && newState.channel && newState.channel.id === channel.id) {
                    const username = newState.member.user.username;
                    const message = `Welcome ${username} to the voice channel ${channelName}`;
                    const outputFilePath = `./welcome-${username}.mp3`;

                    exec(`python3 -m gtts "${message}" --output "${outputFilePath}"`, (err, stdout, stderr) => {
                        if (err) {
                            console.error('Error generating TTS file:', err);
                            return;
                        }

                        console.log('TTS generated successfully.');
                        // Play the generated TTS file after the music finishes playing
                        musicQueue.push(outputFilePath);
                        if (musicQueue.length === 1) {
                            const connection = joinVoiceChannel({
                                channelId: newState.channel.id,
                                guildId: newState.guild.id,
                                adapterCreator: newState.guild.voiceAdapterCreator,
                            });

                            const player = createAudioPlayer();
                            connection.subscribe(player);
                            playNext(connection, player);
                        }
                    });
                }
            });
        } else {
            message.reply('The specified voice channel does not exist.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
